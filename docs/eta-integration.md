# Pickup ETA and verified training observations

The existing map, passenger pin selector, six core tables, and driver GPS controls remain in place. The pickup selector now displays the selected bus, **Approximate ETA**, remaining road distance, the last GPS update and the existing request action. A valid evaluated linear model changes the label to **AI-predicted ETA**. No model has been trained on real journeys in this checkout.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261128004329_eta_training_samples.sql` | One historical feature table, RLS/grants, derived latest course, service-only sample writer and GPS arrival triggers. |
| `supabase/functions/predict-eta/index.ts` | Authenticated passenger prediction and assigned-driver collection; retrieves trusted coordinates/features and calls the router. |
| `supabase/functions/_shared/eta.ts` | GPS validation, route ordering, direction checks, OSRM integration and validated linear inference. |
| `supabase/functions/predict-eta/model.json` | Bundled artifact. Initially explicitly untrained, with routing fallback enabled. |
| `supabase/config.toml`, `supabase/functions/deno.json`, `deno.lock` | JWT verification, Deno type checking and pinned Edge dependencies. |
| `src/features/eta/` | Responsive ETA panel, throttled refresh and best-effort collection client. |
| `src/features/pickups/PickupSelector.tsx` | Shows ETA for the selected pin and captures an observation after request confirmation. |
| `src/hooks/useLocationSharing.ts` | Keeps publishing GPS and attempts collection once per minute while sharing. |
| `scripts/ai/train.py`, `requirements.txt`, `export-samples.sql` | Real data export, chronological training, MAE evaluation and inference artifact export. |
| `scripts/ai/evaluation-status.json` | Latest result from the actual live verified/completed/non-demo export: insufficient data, zero observations, no accuracy claim. |
| `src/features/eta/eta.test.ts`, `scripts/test-eta-training.mjs`, `scripts/ai/test_train.py`, `tests/operations.spec.ts` | ETA behavior, real PostgreSQL security/arrival checks, pipeline checks and desktop/mobile UI checks. |

## Routing and approach detection

The Edge Function receives only a trip UUID and pickup latitude/longitude. It verifies the user's session with Supabase Auth and reads the current active trip, route and latest GPS from a narrow database RPC. The browser cannot supply bus coordinates, distance, speed, training labels or model features.

Use the assigned route's stored road geometry when present. Otherwise ask the configured OSRM-compatible router for a driving path through the assigned origin/destination. Project the bus and pickup onto that ordered path to check proximity and whether the pickup is ahead. Projection distance only determines order and corridor membership; the displayed remaining distance and travel time come from a fresh **road routing response**, through intermediate assigned-route points. Refuse shortcuts or detours that do not follow the assigned corridor.

The latest `bus_location` gains one nullable `course_degrees` field. A database trigger derives it from two accurate consecutive GPS fixes, 2–90 seconds apart, separated by more than the combined reported uncertainty and at least 20 m. It rejects physically implausible displacement above 200 km/h. The previous fix is not retained. This lets approach detection survive an Edge Function cold start without saving a location trail.

Bus fixes older than 90 seconds, fixes more than 10 seconds in the future, missing accuracy or accuracy worse than 100 m cannot produce an ETA. The bus and pickup must be within 150 m of the assigned path. Reverse travel, already-passed pickup positions and ambiguous loops produce explanatory unavailable states. With insufficient movement, wait for direction evidence. A reported speed below 2 km/h produces a routing travel estimate with an explicit unknown waiting-time message. Near the pin, the UI says arrival is being verified; that display is not itself a training label.

Road routing requests time out after 10 seconds. Missing configuration, no driving route, invalid provider results and connection failures never become made-up distances or minutes. Normal frontend calls debounce pin changes and run at most once per 15 seconds for the same pin, with hidden-tab calls skipped. Supabase's existing Realtime/15-second feed drives location updates. Old predictions are hidden as soon as the feed has a newer fix or GPS expires. Warm Edge isolates cache route geometry for five minutes and identical location/pin estimates for 15 seconds, with bounded cache sizes; cold starts simply recalculate.

These per-client/per-isolate limits suit initial use. A busy deployment should use its own router and enforce shared request quotas at the gateway/provider. OSRM's public demo is suitable only for light testing. Its driving profile does not prove that a road or stopping location permits a bus.

## Historical samples and arrival verification

`eta_training_samples` stores trip ID, remaining **road** distance, contemporaneous routing minutes for baseline comparison, optional speed, observation time, Manila hour/weekday, verified arrival time and actual remaining minutes. Two temporary fields hold the request correlation and an arrival candidate. It contains no passenger account ID, name, address, pickup coordinates or bus GPS trail. After verification, the request correlation and candidate are erased.

Only server-side routing code can call `record_eta_sample`. It checks the request remains pending/accepted, the trip remains active and the observed timestamp still exactly matches the latest GPS. Training requires accuracy within 25 m, a target more than 100 m away, positive valid routing features and at most one observation per request per minute. A row lock prevents a late insert racing with a GPS arrival update. GPS with 25–100 m accuracy may support an approximate display but cannot produce training observations.

The assigned driver's sharing page collects for open requests once per minute, independently of whether the passenger stays online. Each invocation handles up to eight requests in pairs, rotating by last attempted collection. Overlapping client collections are prevented. A confirmed passenger request also attempts an immediate initial sample; if the previous bus fix predates the request, it waits for a new fix. Routing/collection failure never stops GPS sharing or pickup submission. Service writes return recorded/skipped/throttled results; only actual inserts count as recorded observations. Demo/test vehicles are excluded from real training.

Actual arrival requires two successive accurate GPS reports within 50 m of the pickup, with at least five seconds between the first candidate and confirming report, and no reporting gap longer than 90 seconds. The first qualifying timestamp becomes `actual_arrival_at`; remaining minutes are computed from timestamps. This verifies arrival near the pin, not boarding. Acceptance is never an arrival event. GPS gaps, implausible jumps, closed requests and ended trips mark incomplete samples rejected with a reason. Intermediate 25–100 m accuracy fixes reset the arrival candidate but do not destroy a valid earlier observation; arrival still requires consecutive fixes within 25 m accuracy. A fast pass without sufficient GPS evidence stays unlabelled. Account for this GPS coverage bias during evaluation.

Completed labels survive trip completion and schedule archiving. Old incomplete observations become rejected on the next GPS report. For abandoned trips, a trusted operator can expire pending observations and erase unneeded old rejection correlations while preserving aggregate diagnostics:

```sql
update public.eta_training_samples
set sample_state='rejected',rejection_reason='observation_expired',arrival_candidate_at=null
where sample_state='pending' and observed_at < now() - interval '12 hours';
update public.eta_training_samples set request_id=null
where sample_state='rejected' and attempted_at < now() - interval '30 days';
```

RLS allows active Admins to read training samples, and only trusted server/service-role code to write. Passengers, guests and employees cannot read the training dataset or forge labels. Existing pickup-coordinate RLS continues to restrict access to the request owner and assigned employee. Internal trigger functions have fixed search paths and no browser execution grants. The context RPC returns public route/location data only, excluding private trip fields.

## Environment and deployment

Browser settings remain `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `VITE_ROUTING_URL` continues to control schedule/map road previews; it is separate from the server's ETA configuration. No new secret goes into any `VITE_` variable.

Set **`ETA_ROUTING_URL`** in Edge Function secrets to an OSRM-compatible base URL, for example `https://router.project-osrm.org` for light testing. A private routing gateway can include its own authentication in its server-side endpoint configuration; the current adapter implements OSRM without provider-specific credential headers. For a provider requiring those headers, add them only in the server adapter. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` inside the Edge runtime. Never copy the latter into frontend settings.

For local Edge testing, copy `supabase/functions/.env.example` to `supabase/functions/.env` and fill in the router URL. Secret env files are ignored. Install Deno or use `npx deno`; the web application still runs with Node.

Review the migration before applying it to the intended linked Supabase project. Existing earlier migrations must already be present. The initial ETA migration and authenticated Edge Function have been deployed to the BUSTRA project; use the following steps for a new installation or future update.

```powershell
# Confirm the intended project reference in your existing CLI link first.
supabase migration list
supabase db push --dry-run
# After reviewing the pending list, apply migrations:
supabase db push

# Fill the ignored local file with ETA_ROUTING_URL before setting secrets.
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy predict-eta --use-api
```

JWT verification stays enabled in `supabase/config.toml`; the function also verifies the user with `auth.getUser`. Call from a signed-in session through `supabase.functions.invoke`. For local serving, use `supabase functions serve predict-eta --env-file supabase/functions/.env` with a running local Supabase stack and migrations applied. Publish/rebuild the React app through the existing deployment workflow after backend setup. No frontend bundle is sufficient to deploy the Edge Function or migration.

The request body is `{ "trip_id": "UUID", "pickup_latitude": 13.225, "pickup_longitude": 120.595 }`. The assigned-driver collector instead sends `{ "trip_id": "UUID", "collect": true }`. Collection requests are checked against the current driver assignment. Prediction responses contain `status`, `source`, nullable `minutes`/`road_distance_m`, `location_updated_at` and an explanatory `message`. Model responses also include `model_version`.

Choosing a pickup pin sends that position and the bus position through the ETA service to the routing provider. The ETA table does not retain those coordinates. Confirmed requests retain their existing private coordinates. The selector explains that a chosen pin is used for travel calculations; demo trips never call prediction or collect training samples.

## Training and model activation

Export only verified observations using [`export-samples.sql`](../scripts/ai/export-samples.sql), in a trusted SQL session, and download CSV. The header-only [`arrival-data-template.csv`](../scripts/ai/arrival-data-template.csv) documents the exact expected columns. Do not manufacture rows to obtain a deployable artifact.

```powershell
python -m venv .artifacts/eta-venv
.artifacts/eta-venv/Scripts/python.exe -m pip install -r scripts/ai/requirements.txt
.artifacts/eta-venv/Scripts/python.exe scripts/ai/train.py PATH_TO_VERIFIED_SAMPLES.csv
# Optional fixed Random Forest challenger:
.artifacts/eta-venv/Scripts/python.exe scripts/ai/train.py PATH_TO_VERIFIED_SAMPLES.csv --random-forest
```

`requirements.lock.txt` records the exact package versions used to verify this pipeline; use it instead of `requirements.txt` when reproducing that environment on a compatible Python/platform.

Numerical features are road kilometres, speed (0 when missing), a missing-speed flag, sine/cosine of Manila time and Monday-zero weekday. Target minutes must match verified arrival/observation timestamps. Invalid, incomplete and duplicate rows are excluded. Use actual routing times stored with each observation for the baseline, not an arbitrary constant speed.

The initial experiment requires at least 60 valid observations from 30 distinct completed trips, with at least 20 training trips and six future holdout trips after purging. This is a minimum experiment size, not an accuracy guarantee. The latest 20% of trips form the holdout. Every trip stays in one partition; any training trip whose arrival labels overlap the holdout's start is purged completely. Scaling fits only training data. The model is scikit-learn `LinearRegression` with `StandardScaler`.

With enough data, outputs go to ignored `.artifacts/eta-model/`: `model.joblib`, `model.json`, `metrics.json` and `holdout-predictions.csv`. Metrics report MAE in minutes for routing, raw linear predictions and the actual serving rule, including out-of-range fallback; AI coverage and per-trip errors are included. Optional Random Forest outputs an additional trusted local artifact and MAE. It cannot run through linear TypeScript inference; substantial improvement is a reason to evaluate another future holdout and build a private Python service.

With insufficient data, the script exits **2** and writes only an explicit untrained JSON artifact and insufficient-data metrics. It makes no accuracy claim. The latest checked-in evaluation status was generated from the actual hosted verified/completed/non-demo export, which contained zero rows.

The linear JSON includes feature order, timezone, scaling, coefficients, training feature bounds, version and holdout metrics. Training verifies exported predictions match the Python pipeline. Inference requires matching schema/features, valid finite parameters, an eligible artifact and holdout improvement over routing. Inputs outside training bounds or unsafe predictions fall back to routing. A stopped bus uses routing with the unknown waiting-time message.

After reviewing real results, route/time coverage, MAE and predictions against independent later arrivals, use `scripts/ai/activate-model.ts` to validate the eligible artifact and its exported Python/TypeScript parity cases before replacing the bundled JSON and redeploying. It rejects test-fixture artifacts, inadequate holdout coverage and models that do not improve on routing. See [the completion audit and field guide](ai-completion.md). The web app never downloads Python artifacts or receives service credentials.

## Verification and field testing

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:db
npm.cmd run build
npx.cmd deno check --config supabase/functions/deno.json supabase/functions/predict-eta/index.ts
.artifacts/eta-venv/Scripts/python.exe -m unittest discover -s scripts/ai -p test_train.py -v
npx.cmd playwright test tests/operations.spec.ts --grep "ETA|pickup|passenger GPS|assessment|manually adjusted"
# Optional real router availability check with fixed example endpoints:
npx.cmd deno run --config supabase/functions/deno.json --allow-net --allow-env scripts/ai/route-smoke.ts
```

Unit tests cover approach, moving away, passed pickup, stopped bus, missing/inaccurate/stale GPS, off-route pins, ambiguous loops, invalid/no-route responses, connection failure and missing/valid/invalid model fallback. Database tests execute actual migrations in embedded PostgreSQL, including grants, RLS, trusted sampling, acceptance without arrival, GPS verification, course calculation, unreliable observation rejection and history retention. Python tests use explicitly synthetic fixtures only to verify splitting, training and export plumbing; those fixtures are never published as production artifacts or accuracy evidence. Browser tests mock the service to verify presentation, requests, failures and stale/offline behavior on desktop and mobile.

After deployment, test on two signed-in devices with one assigned employee publishing real GPS and a passenger choosing an ahead-of-bus curbside pin. Confirm arrival using actual fixes, inspect completed sample timestamps, then export and compare predictions with those measured travel times. Repeat with reverse travel, a passed pin, a stop, inaccurate GPS, router failure and loss of connectivity. Test the untrained fallback first; activate a model only after real-data evaluation. Hosted auth/Realtime, mobile permissions and field accuracy require these deployment checks; local mocks do not prove them.

Implementation references: [Supabase Edge authentication](https://supabase.com/docs/guides/functions/auth), [server secrets](https://supabase.com/docs/guides/functions/secrets), [OSRM route API](https://project-osrm.org/docs/v5.24.0/api/), [scikit-learn LinearRegression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LinearRegression.html).
