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

During implementation, the supplied project's Auth settings returned **200**, while `public_feed` returned **404**. Hosted database changes have **not** been applied. The connected Supabase management tool did not have access to the supplied project.

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

This checkout is prepared for local review; no GitHub push or hosted deployment has been performed. Build with the two public environment variables set, then publish `dist/` to a static host supporting **SPA fallback to `index.html`**. Configure your host to serve all app paths (for example `/map` and `/login`) through the SPA. `public/_redirects` is included for compatible hosts. Add the deployed URL to Supabase Auth redirects. Use HTTPS for GPS. Never deploy a private environment file.

OpenStreetMap community tiles are used for light development with visible attribution. Before production, review the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and configure `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` for an appropriate tile provider. No prefetching, offline tile packs, or scraping is implemented. The default map viewport is approximate Mamburao; viewport configuration is never treated as a bus position.

The optional trainable ETA script is in `scripts/ai/`, with data requirements in [`docs/ai-plan.md`](docs/ai-plan.md). **AI prediction is planned / not trained.** There is no fabricated accuracy or inference service.

Architecture, ERD, and data dictionary: [`docs/architecture.md`](docs/architecture.md). Upstream references: [Supabase signup](https://supabase.com/docs/reference/javascript/auth-signup), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime](https://supabase.com/docs/guides/realtime/postgres-changes), [Tailwind + Vite](https://tailwindcss.com/docs/installation/using-vite).
