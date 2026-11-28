# AI audit, route diagnostics and real-data completion

## Current blockers found on 28 November 2026

The live active trip had no stored road geometry and no operator review. The ETA service therefore generated a shortest driving suggestion between the assigned origin and destination. Its reported bus GPS was about **167 m** from that path, while the selected pickup was about **55 m** away. Latitude/longitude ordering was correct. The bus reported zero speed, so travel toward the pickup could not be confirmed. The existing **150 m corridor is unchanged**.

The operator confirmed the active `DEMO 002` GPS was a development/simulated test. These reports are not evidence of actual journeys and must not train a production model. Do not rename a test bus to make it pass the filter; register and operate an actual service vehicle for field collection.

The audit found **zero real verified training observations**. There is no honest production MAE, trained model or AI prediction to report until physical journeys have supplied enough verified labels. The code supports training and activation once that evidence exists; it does not fabricate it.

The previous collection implementation also returned no explanation for skipped writes, counted some skipped writes as recorded samples, discarded all pending samples after a single intermediate GPS accuracy report worse than 25 m, and did not retain reasons for incomplete observations. Collection batches were serial and tied to the oldest twenty requests. These software blockers are fixed below.

## Use the diagnostics

Sign in as an Admin and open **Admin → Route diagnostics**, or as the assigned employee and open **Employee → Route diagnostics**. Choose the trip. The map shows the assigned A/B endpoints, actual stored/generated road line, reported bus GPS with its accuracy circle, and a temporary or assigned-request pickup pin. Numeric diagnostics identify the bus and pickup offsets separately, GPS freshness, accuracy, speed, course and coordinate order.

An assigned driver can select their existing pickup requests. Admins can inspect a temporary pin, but existing private passenger coordinates remain restricted to the owner and assigned employee. Diagnostic pins are browser state only; they do not modify requests, GPS or route data.

If the route misses the roads actually used, an Admin chooses **Review assigned road path**, then **Choose road waypoint**. Click the actual road(s) in travel order, preview again, check the operator approval only after review, and save through the existing route editor. A driving suggestion is not evidence that the bus uses those roads. If GPS is incorrect or simulated, correct the reporting device instead of changing the route to accommodate a false position. Reversed/stale saved endpoint geometry is rejected with a specific explanation.

Passengers also see the generated road path, reported bus GPS and their pickup pin together even when a mismatch prevents ETA. Separate `bus_off_route` and `pickup_off_route` responses explain which location needs attention. No distance limit was widened and no GPS position was silently moved.

## Admin AI Status

Open **Admin → AI Status**. Counts come from the database and model status comes from the artifact actually bundled in `predict-eta`.

The panel shows total observations containing road features, verified arrivals, distinct completed trips with usable labels, pending observations, rejected checks grouped by reason, active-trip GPS/collection health, current model state and training requirements. Rejected checks without road features are diagnostic events, not training samples. Zero observations may mean no confirmed pickup, no driver collection check, missing/stale/imprecise GPS, an off-route point, unconfirmed direction, a router failure, a reporting gap, a closed request, a demo vehicle, or arrival still awaiting confirmation.

The status endpoint requires an active Admin. Staff route checks require an active Admin or the assigned employee. Only the assigned employee can request collection for their trip. Service-only SQL writers enforce the request/trip/GPS checks; browser accounts cannot forge sample features or labels.

## Database and collection changes

Apply `supabase/migrations/20261128021714_eta_diagnostics_and_collection.sql` after all existing migrations. It adds no tables. It extends `eta_training_samples` with `sample_state`, `rejection_reason` and `attempted_at`; road-feature fields may be absent only on rejected diagnostic checks. It adds one small `eta_collection_status` JSON field to the latest bus-location row, containing only a timestamp, status and counts.

GPS triggers now run only when GPS columns are written, so collection metadata cannot reset the course or invalidate observations. Confirmed arrivals clear the temporary request correlation. Rejected outcomes retain reason codes without names, passenger IDs, addresses, coordinates or GPS trails. Completed verified observations remain usable after the trip ends. For retention SQL, see [the integration guide](eta-integration.md).

Collection attempts happen after successful assigned-driver GPS writes at most once per minute. The passenger may close their page. In-flight collection calls are not overlapped; up to eight targets are selected by least-recent attempt and processed in pairs. Skipped and throttled writes are reported accurately. The driver sees a collection status independently of GPS status; routing failures never stop GPS sharing. The driver's browser must stay active because this remains a browser GPS application.

Initial observation accuracy must be within 25 m and the target must be more than 100 m away. Two successive fixes within 25 m accuracy and within 50 m of the pickup, at least five seconds apart, establish arrival. A 25–100 m intermediate fix is ignored for arrival and resets the arrival candidate, while a gap over 90 seconds or an implausible GPS jump invalidates pending samples. Accepting a request never supplies a label. The original timestamp-consistency constraint remains enforced.

## Field collection before real AI training

1. Register the actual service vehicle, create a real schedule with correct endpoints, assign its driver and review the road path against actual operations.
2. Start that trip as the assigned driver. Share precise GPS from a device on the bus, without DevTools overrides. Keep the employee page active.
3. A passenger confirms a pickup ahead of the bus on the assigned road. Observe the real routing ETA first. Confirmed requests provide the target for collection; an unconfirmed draft pin does not create training history.
4. Continue GPS sharing through arrival so successive good reports can verify it. The passenger may close the website. Inspect **AI Status** for pending, verified or rejected outcomes and reason counts.
5. Complete the trip. Repeat across representative routes, weekdays, times and traffic conditions. Begin the experiment only after at least **60 verified observations from 30 completed real trips**, with at least 20 training and six later holdout trips surviving overlap purging. These are minimum experimental thresholds, not an accuracy guarantee.

GPS proximity verifies arrival near a requested location, not boarding or legal permission to stop. An arrival without sufficient GPS evidence remains unlabelled. Account for missing GPS coverage when interpreting evaluation results.

## Export, train, evaluate and activate

Run `scripts/ai/export-samples.sql` in a trusted SQL session and download CSV. It selects only verified labels from completed trips and excludes demo/test buses. It exports only the numerical features, trip identifier and timestamps needed for training.

```powershell
.artifacts/eta-venv/Scripts/python.exe -m pip install -r scripts/ai/requirements.txt
.artifacts/eta-venv/Scripts/python.exe scripts/ai/train.py PATH_TO_REAL_VERIFIED_EXPORT.csv --output .artifacts/eta-real-model
```

The script fits `StandardScaler` and scikit-learn `LinearRegression` on training data only. It holds out the latest 20% of complete trip groups and purges entire training trips whose arrival labels extend into that holdout period. It reports raw-model, routing and actual serving-rule MAE, supported holdout coverage and per-trip errors. The routing baseline is the road duration recorded at the same observation, not an arbitrary speed assumption.

Insufficient data produces exit code **2**, explicit untrained JSON and counts, without a trained binary or invented MAE. Synthetic fixture IDs mark output as test-only and ineligible for activation. Real-data artifacts are eligible only when raw and fallback-aware MAE improve on routing and model-supported predictions cover at least six later test trips.

With enough real data, review `metrics.json`, `holdout-predictions.csv`, route/time coverage and another later field period. Then validate the artifact and Python/TypeScript parity:

```powershell
npx.cmd deno run --config supabase/functions/deno.json --allow-read scripts/ai/activate-model.ts .artifacts/eta-real-model/model.json
# Only after reviewing valid real results:
npx.cmd deno run --config supabase/functions/deno.json --allow-read --allow-write scripts/ai/activate-model.ts .artifacts/eta-real-model/model.json --activate
supabase functions deploy predict-eta --project-ref gfpremoiypartyvchwzm --use-api
```

The validator requires real-data provenance metadata, the dataset fingerprint, finite validated coefficients/preprocessing, eligible holdout metrics and matching exported prediction cases. It rejects fixtures and tampered/mismatched inference. The Edge Function also validates model parameters and input feature bounds at runtime. Missing, invalid, unsupported or underperforming models keep routing fallback. **AI-predicted ETA** appears only for an actual accepted linear inference result; a stopped bus retains the approximate travel-time message because waiting time is unknown.

No automatic future training/deployment is scheduled. Re-run export, evaluation and activation when sufficient real observations exist. Do not activate a model merely to change a label.

## Verification

```powershell
npm.cmd run check
npx.cmd deno check --config supabase/functions/deno.json supabase/functions/predict-eta/index.ts scripts/ai/activate-model.ts
.artifacts/eta-venv/Scripts/python.exe -m unittest discover -s scripts/ai -p test_train.py -v
npx.cmd playwright test tests/operations.spec.ts --grep "AI Status|route diagnostics|generated road path|road waypoint|pickup|ETA"
```

Automated tests use isolated PostgreSQL roles, migrations and explicitly labelled software fixtures, plus mocked browser service responses. The database workflow exercises schedule creation, assigned start, request creation, GPS publication, pending labels after acceptance, arrival verification without a passenger session, trip completion and verified export. Fixtures never enter hosted training data. Real-data model MAE and real moving-bus field accuracy remain unavailable until the field collection above is performed.

Executed results for this update: **43 unit tests, 105 PostgreSQL checks, 3 Python tests and 90 desktop/mobile browser tests passed** in the working checkout. The isolated publication candidate separately passed type/unit/database/build checks and all eight focused desktop/mobile diagnostics checks. Deno checks passed for the function and activation script. Hosted SQL confirmed the new status RPC returns the actual zero counts and guests/browser accounts cannot write samples or forge rejections. The live completed/non-demo export produced zero rows; training returned `insufficient_data` (exit 2), so no production model or MAE was created. Supabase's error-level security advisor check returned no issues. Route accuracy on an actual moving bus still needs the field run above.
