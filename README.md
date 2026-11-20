# BUSTRA

Bus Tracking and Passenger Pickup Request System — a responsive, web-only BSIT capstone for Mamburao, Occidental Mindoro. Built with React, TypeScript, Vite, Tailwind CSS, React Router, Leaflet, and Supabase.

Public visitors can view the map and schedules immediately. Passengers request a pickup at a designated stop. A shared employee dashboard provides schedules, assigned-trip GPS sharing, passenger counts, and request responses. Administrators manage people, buses, routes, stops, and schedules.

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
2. In **SQL Editor**, open a new query, paste the complete contents of [`supabase/migrations/202611200001_bustra_core.sql`](supabase/migrations/202611200001_bustra_core.sql), and run it as the trusted project owner. The transaction creates exactly seven application tables, policies, triggers, indexes, and RPCs. Do not paste it into the browser console.
3. In **Authentication → URL configuration**, set the site URL and allowed redirects for `http://127.0.0.1:5173/login`, `http://127.0.0.1:5173/update-password`, and your future HTTPS host. If using `localhost` instead, allow that origin too.
4. Enable email/password signup. Keep email confirmation enabled for public deployments. Configure SMTP for reliable delivery; provider rate limits still apply. The registration screen directs the user to login and explains verification.
5. Enable the Data API for `public`. Keep the `private` schema unexposed. The migration provides explicit table/function grants and enables RLS on every application table.
6. The migration adds `profiles`, `trips`, `bus_location`, and `pickup_requests` to `supabase_realtime` if that publication exists. For local/self-hosted setups without it, enable the publication using the Supabase Realtime setup instructions. Subscriptions respect RLS. Public trip data is refreshed through a narrow RPC every 15 seconds because private trip rows must not be exposed to guests.
7. Verify the public connection:

```powershell
node --env-file=.env.local scripts/check-connection.mjs
```

Both endpoints should return OK. A 404 for `public_feed` means the migration is missing or the API schema cache has not refreshed. The check is read-only and prints no keys.

The project owner has applied the migration and development seed in hosted Supabase, created the admin and employee accounts, and confirmed a new signup after configuring Brevo SMTP. The connected Supabase management tool still lacks access to this project; use the trusted dashboard for Auth URL configuration and database administration. Do not rerun the initial migration over the existing tables.

## Create the single admin and employee test accounts

1. After applying the migration, register a normal account through `/register`; verify its email if required.
2. Copy its exact UUID from **Authentication → Users**.
3. Open [`supabase/bootstrap-admin.sql`](supabase/bootstrap-admin.sql). Replace `REPLACE_WITH_EXACT_AUTH_USER_UUID` with that UUID, then run it in the trusted SQL Editor. It refuses to run if an admin already exists. No public function can create an admin, and the database protects that sole admin against deletion/demotion.
4. Sign in or refresh. The admin dashboard loads its role from the database. Register two more normal accounts, then promote them to `employee` using **Users → Edit → Account access**. Assign one to a trip to test driver-only controls.
5. For a passenger test, use a separate registered user account. There are no built-in passwords or fake authenticated accounts.

Existing Auth accounts created before this schema need profiles. See [`docs/setup.md`](docs/setup.md) for the trusted backfill query.

## Demo and real service data

The default app requests **real** public data and shows an honest empty/error state when none is available. Choose **Explore demo** in the connection notice, or open `/?demo=1` for an explicit illustrative demo. Demo bus positions are fixed, outdated, and never labelled live; demo pickup submissions are disabled. Exiting demo returns to the real backend.

The optional [`supabase/seed.sql`](supabase/seed.sql) inserts explicitly labelled development buses, routes, illustrative pickup points, and one unassigned future schedule if an admin exists. Run it manually only in a development project. It creates no credentials, assigned drivers, active trips, or GPS positions. Real stops and routes must be supplied by an authorised operator, with verified coordinates.

To test a real local journey, create a bus and route, add stops, create a scheduled trip with an employee, then sign in as that employee and edit the schedule to `active`. Select the trip and press **Start sharing location** on a GPS-enabled device. Use a trusted HTTPS development host for mobile GPS; loopback URLs on a phone point to the phone, not your computer.

## Map routes and symbols

Add at least two **active pickup points** to each route using **Admin → Pickup points**. Give them distinct stop-order values: the first point is the origin, intermediate points are stops, and the last point is the destination. Verify their latitude/longitude with the operator. A route name or a departure schedule alone cannot provide map coordinates.

The map initially draws a **dashed stop-to-stop guide**. Press **Trace road route** to request an estimated driving route through those configured stops. A solid line follows the routing result; it is not a record of the bus's movement or a certified bus-accessible itinerary. Failed routing leaves the guide visible. Ambiguous ordering or fewer than two active points produces an explanation rather than an invented route.

- **Blue bus + plate label:** last GPS position reported by the assigned employee. It turns grey after 90 seconds without an update. **Find bus** centres on the selected bus, or the first displayed bus if none is selected.
- **Orange person + count:** pending pickup requests at a designated stop. **Teal person:** accepted requests; this does not confirm boarding. Guests see stops but no private request counts. Passengers see their own requests; staff and admin see only rows allowed by database RLS. The marker is the selected stop, not a passenger's live device location.
- **Green A / red B / flag:** route origin, destination, and intermediate pickup stops.
- **Purple person + accuracy circle:** the viewer's device location from **Locate me**, kept in that browser. Employee **Start sharing location** is the separate action that publishes the bus position.

For Android testing, open the HTTPS site in Chrome, enable Android Location and precise location for Chrome, allow the site's location permission, and keep the employee page active. Laptop location may be very approximate. Chrome DevTools Sensors overrides simulate a location; remove overrides for real GPS. The app rejects bus reports with accuracy worse than 100 metres. The database stores only the latest bus position, so no historical journey trail is shown.

Road routing defaults to the public [OSRM demo service](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) for light testing. Requests are explicit, cached per browser tab, and queued at less than one per second per tab. Only public configured stops are sent, never passenger/device positions. Public demo capacity is shared and has no availability guarantee; set `VITE_ROUTING_URL` to your own compatible OSRM endpoint for wider use. Driving results require operator review for bus restrictions.

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

## Permissions and operations

The database authorises requests independently of the interface. Profiles are private; passengers can update only their own names. Staff can manage schedules; only the assigned employee can start an assigned trip, publish GPS, adjust counts, or answer pickups. Active assignments cannot be hijacked. Admins can start/end trips for management and can grant only `user`/`employee` through the role RPC. Finished schedules are retained as history. Referenced data cannot be deleted accidentally.

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
