# BUSTRA

Bus Tracking and Passenger Pickup Request System — a responsive, web-only BSIT capstone for Mamburao, Occidental Mindoro. Built with React, TypeScript, Vite, Tailwind CSS, React Router, Leaflet, and Supabase.

Public visitors can view the map and schedules immediately. Passengers request a pickup using GPS or an adjustable map pin. A shared employee dashboard provides schedules, assigned-trip GPS sharing, passenger counts, and request responses. Administrators manage people, buses, routes, and schedules.

## Run locally

Use Node **22.12+** (Node 24 recommended) and npm. In Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```powershell
npm.cmd install
Copy-Item .env.example .env.local
# Fill in the two public Supabase values in .env.local.
npm.cmd run dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. For this workspace, `.env.local` is already configured with the supplied public project settings. Do not overwrite it with the blank example.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

The publishable key belongs in a browser app; it grants no administrative access. Never add a Supabase secret or service-role key. `.env.local`, generated artifacts, dependencies, and build output are ignored by Git. Environment variables are embedded at **build time**; rebuild after changing them.

## Your BUSTRA logo

Save your PNG logo as **`public/bustra-logo.png`**. The shared branding component automatically loads it in the navigation, account pages, footer, and dashboards, and uses it as the browser tab icon after loading. Until that file exists, the existing bus symbol and SVG favicon remain available. Use an actual PNG file; renaming a JPEG does not convert its format.

## Set up Supabase

1. Open your intended project in the [Supabase dashboard](https://supabase.com/dashboard). Inspect existing tables first. The initial migration expects the seven BUSTRA tables not to exist; do not run it over a different existing BUSTRA schema.
2. In **SQL Editor**, open a new query, paste the complete contents of [`supabase/migrations/202611200001_bustra_core.sql`](supabase/migrations/202611200001_bustra_core.sql), and run it as the trusted project owner. The initial transaction creates seven tables; apply every later migration in filename order. The latest pickup migration safely retires the old catalog, leaving six main tables. Do not paste it into the browser console.
3. In **Authentication → URL configuration**, set the site URL and allowed redirects for `http://127.0.0.1:5173/login`, `http://127.0.0.1:5173/update-password`, and your future HTTPS host. If using `localhost` instead, allow that origin too.
4. Enable email/password signup. Keep email confirmation enabled for public deployments. Configure SMTP for reliable delivery; provider rate limits still apply. The registration screen directs the user to login and explains verification.
5. Enable the Data API for `public`. Keep the `private` schema unexposed. The migration provides explicit table/function grants and enables RLS on every application table.
6. The migration adds `profiles`, `trips`, `bus_location`, and `pickup_requests` to `supabase_realtime` if that publication exists. For local/self-hosted setups without it, enable the publication using the Supabase Realtime setup instructions. Subscriptions respect RLS. Public trip data is refreshed through a narrow RPC every 15 seconds because private trip rows must not be exposed to guests.
7. Verify the public connection:

```powershell
node --env-file=.env.local scripts/check-connection.mjs
```

Both endpoints should return OK. A 404 for `public_feed` means the migration is missing or the API schema cache has not refreshed. The check is read-only and prints no keys.

The project owner applied the initial migration and development seed, created admin/employee accounts, and confirmed signup after configuring Brevo SMTP. The automatic-route and dynamic-location upgrades were applied using the authenticated Supabase CLI. The management connector lacks project access, but the CLI connection works. Do not rerun the initial migration over existing tables. For a fresh installation, apply every file in `supabase/migrations/` in filename order before creating schedules.

## Create the first admin and manage account roles

1. After applying the migration, register a normal account through `/register`; verify its email if required.
2. Copy its exact UUID from **Authentication → Users**.
3. Open [`supabase/bootstrap-admin.sql`](supabase/bootstrap-admin.sql). Replace `REPLACE_WITH_EXACT_AUTH_USER_UUID` with that UUID, then run it in the trusted SQL Editor. It refuses to run if an admin already exists. Developers bootstrap the first Admin securely. After the role-management migration, authorized active Admins can assign User, Employee or Admin to existing accounts, with confirmation for Admin changes and protection for the last active Admin.
4. Sign in or refresh. The admin dashboard loads its role from the database. Register two more normal accounts, then promote them to `employee` using **Users → Edit → Account access**. Assign one to a trip to test driver-only controls.
5. For a passenger test, use a separate registered user account. There are no built-in passwords or fake authenticated accounts.

Existing Auth accounts created before this schema need profiles. See [`docs/setup.md`](docs/setup.md) for the trusted backfill query.

## Demo and real service data

The default app requests **real** public data and shows an honest empty/error state when none is available. Choose **Explore demo** in the connection notice, or open `/?demo=1` for an explicit illustrative demo. Demo bus positions are fixed, outdated, and never labelled live; demo pickup submissions are disabled. Exiting demo returns to the real backend.

The optional [`supabase/seed.sql`](supabase/seed.sql) inserts explicitly labelled development buses, routes, and one unassigned future schedule if an admin exists. Apply all migrations first and run the seed only in a development project. It creates no credentials, assigned drivers, active trips, or GPS positions. Employees confirm real route endpoints; passengers choose their pickup pins.

To test a journey, create a schedule with confirmed origin/destination coordinates, assign a driver, and start the trip. Passengers choose their own pickup pins. The assigned employee uses **Start** in the schedule row and **Start sharing location** on a GPS-enabled device. Use HTTPS for mobile GPS; loopback URLs on a phone point to the phone, not your computer.

## Dynamic schedule locations

**Origin** and **Destination** now support searchable addresses and **Choose on Map**. Photon searches cities, barangays, landmarks, streets and complete addresses without requiring any saved Supabase location. Selecting a suggestion places a pin; clicking/tapping the map, dragging a pin or using its arrow keys adjusts the coordinates. Reverse lookup fills a nearby address when available; otherwise the employee supplies a custom label while keeping the selected coordinates.

The form shows the generated route name and either an existing reviewed path or a configured router's driving suggestion. It requires explicit location/route confirmation before **Save Schedule**. Changing locations, labels or assignment clears confirmation. Missing search results or routing do not invent addresses or road lines; map/custom-label selection and a pending-review schedule remain available. Bus, driver, departure time and initial passenger count retain their validation and controls.

The additive [dynamic-location migration](supabase/migrations/20261120055359_dynamic_schedule_locations.sql) adds the requested origin_lat, origin_lng, destination_lat and destination_lng fields, backfills previous coordinates and preserves records and legacy aliases. Route matching uses normalized endpoint labels plus a 50-metre tolerance at both endpoints, with transaction locking to prevent concurrent duplicate creation. Equal labels at distant positions are separate routes. New locations need no database registration. Route approval remains separate from passenger pin requests; see the latest pickup guide.

See [the complete component, API configuration and testing guide](docs/dynamic-locations.md).

## Map routes and symbols

Passengers select a one-time pickup position through GPS or the map; no stop catalog is required. Only the owner and assigned employee may read the coordinates. Driver review is required for safe and permitted stopping; proximity to a road path never guarantees boarding.

The map draws saved **green operator-reviewed road paths**, **blue suggested driving paths** when routing is configured, and **dashed endpoint guides** when geometry is unavailable. Endpoint guides are not road geometry. Pickup proximity uses stored actual geometry only; without it, requests are explicitly unverified.

- **Blue bus + plate label:** latest employee GPS report, grey after 90 seconds. **Find bus** centres the bus.
- **Orange person / teal person:** private pending / accepted passenger pickup positions. These are confirmed pins, not continuous passenger tracking.
- **Green A / red B:** route origin / destination.
- **Purple person + accuracy circle:** viewer's browser-only location from **Locate me**. Employee bus sharing is separate.

See [dynamic pickup components, migration, permissions, configuration and testing](docs/dynamic-pickups.md).

For Android testing, open the HTTPS site in Chrome, enable Android Location and precise location for Chrome, allow the site's location permission, and keep the employee page active. Laptop location may be very approximate. Chrome DevTools Sensors overrides simulate a location; remove overrides for real GPS. The app rejects bus reports with accuracy worse than 100 metres. The database stores only the latest bus position, so no historical journey trail is shown.

Road routing is disabled when `VITE_ROUTING_URL` is blank. The current test deployment configures the public [OSRM demo service](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) for light testing. Routing is cached per browser tab and queued at less than one request per second per tab. Confirmed route endpoints and employee-selected schedule positions are sent to the router; passenger/device tracking positions are not. Public demo capacity is shared and has no availability guarantee; configure your own compatible endpoint for wider use. Stored approved geometry remains visible if routing becomes unavailable.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:db
npm.cmd run build
npm.cmd run test:e2e
```

- Unit tests validate signup inputs, safe return URLs, GPS freshness, and the non-AI ETA calculation.
- Database tests run the **actual migration** in embedded PostgreSQL (PGlite), with mock Supabase Auth identities and real roles, grants, RLS, triggers, and RPCs. They do not connect to or modify hosted Supabase.
- Browser tests use installed Google Chrome, at desktop and iPhone-sized viewports. They exercise public pages, forms, demo details, filters, guest access, and intended pickup redirects with a controlled backend. Install Chrome or change the Playwright channel for your machine.
- See [`docs/verification.md`](docs/verification.md) for outcomes and limitations. Live email flows, two-device Realtime delivery, real GPS permissions, and simultaneous multi-connection load need hosted integration checks after schema setup.

## Role management

See [multi-admin role management](docs/role-management.md) for the migration, authorization, private audit history and testing steps. Registration still assigns User, and all three roles share one Login page. Admin target accounts must be verified and not banned/deleted. Reassign unfinished trips before changing an Employee role.

## Permissions and operations

The database authorises requests independently of the interface. Profiles are private; passengers can update only their own names. Staff can manage schedules; only the assigned employee can start an assigned trip, publish GPS, adjust counts, or answer pickups. Active assignments cannot be hijacked. Admins can start/end trips for management and assign `user`, `employee` or `admin` through a guarded atomic operation. Admin privilege changes require confirmation and are recorded in private audit history; the last active Admin cannot be removed. Finished schedules are retained as history. Referenced data cannot be deleted accidentally.

Accounts are created through the shared registration flow. Deleting an Auth account requires trusted project administration and session revocation; the browser has no service-role account deletion or admin creation endpoint. The admin table deliberately does not expose emails from `auth.users`.

Passenger changes are atomic ±1 operations with a row lock and database capacity checks. Accepting a pickup does not add passengers. A pickup request is neither a seat reservation nor a boarding guarantee. No passenger manifests, payments, or seats are stored.

## Deployment

Source is pushed to [bahalanaevryone/bustra-web](https://github.com/bahalanaevryone/bustra-web). GitHub Pages is configured for [the BUSTRA test site](https://bahalanaevryone.github.io/bustra-web/), with automatic deployment from `main` using [the workflow](.github/workflows/deploy-pages.yml). Check the repository's **Actions** tab for each deployment result before sharing a new build. The two public Supabase values are repository Actions variables; no private environment file is committed or uploaded. The workflow runs type, unit, database-integrity and build checks before publishing.

Before email signup/reset testing on the hosted site, open **Supabase → Authentication → URL Configuration** and save:

- **Site URL:** `https://bahalanaevryone.github.io/bustra-web/`
- **Redirect URLs:** `https://bahalanaevryone.github.io/bustra-web/login` and `https://bahalanaevryone.github.io/bustra-web/update-password`
- Keep the local development redirects if you still use the laptop.

The build uses `VITE_BASE_PATH=/bustra-web/`; Router links, logos, asset paths and Auth redirects include that prefix. GitHub Pages serves the application through a generated `404.html` for direct deep links; those navigation responses retain HTTP 404 although the app loads. For a host with full SPA rewriting, publish `dist/` with the appropriate `VITE_BASE_PATH` (normally `/`) and route all app paths to `index.html`. `public/_redirects` is included for compatible hosts. Use HTTPS for phone GPS.

OpenStreetMap community tiles are used for light development with visible attribution. Before production, review the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and configure `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` for an appropriate tile provider. No prefetching, offline tile packs, or scraping is implemented. The default map viewport is approximate Mamburao; viewport configuration is never treated as a bus position.

The optional trainable ETA script is in `scripts/ai/`, with data requirements in [`docs/ai-plan.md`](docs/ai-plan.md). **AI prediction is planned / not trained.** There is no fabricated accuracy or inference service.

Architecture, ERD, and data dictionary: [`docs/architecture.md`](docs/architecture.md). Upstream references: [Supabase signup](https://supabase.com/docs/reference/javascript/auth-signup), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime](https://supabase.com/docs/guides/realtime/postgres-changes), [Tailwind + Vite](https://tailwindcss.com/docs/installation/using-vite).
