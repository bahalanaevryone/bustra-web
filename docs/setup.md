# Project setup details

Apply all migrations in filename order on a fresh database. Later pickup/role migrations supersede the historical seven-table, fixed-stop and single-admin rules described in earlier setup steps.

Apply the initial migration only after inspecting the target project's current schema. It is intentionally not a destructive reconciliation script. Use the SQL Editor workflow in the README; do not enable permissive policies to work around configuration errors.

For a BUSTRA database that has only the initial schema, apply the additive migration [`20261120050109_automatic_schedule_routes.sql`](../supabase/migrations/20261120050109_automatic_schedule_routes.sql). It retains all seven tables and trip references, adds normalized endpoint uniqueness and reviewed road geometry, and replaces public RPCs with wrappers that preserve their original safeguards. Existing duplicate endpoint pairs cause an atomic refusal; review their dependent trips/stops before retrying rather than deleting them blindly. The current hosted project has already received this upgrade.

Routes remain unapproved until an administrator reviews the road path and active stops. Configure the public `VITE_ROUTING_URL` Actions variable for the hosted build and the equivalent local `.env.local` value for local previews, then rebuild/restart as appropriate. An empty value disables routing. The existing seed is illustrative and is not transport approval. Do not mark it approved just to bypass validation.

If Auth accounts already existed before the profile trigger was installed, run this trusted, one-time backfill after reviewing those accounts. It forces all of them to the passenger role. Developers bootstrap the first Admin separately using its exact UUID; later Admin promotions use User Management.

```sql
insert into public.profiles(id,first_name,last_name,role)
select id,
  left(coalesce(nullif(trim(raw_user_meta_data->>'first_name'),''),'Passenger'),80),
  left(coalesce(nullif(trim(raw_user_meta_data->>'last_name'),''),'Account'),80),
  'user'
from auth.users
on conflict(id) do nothing;
```

If PostgREST still cannot find a function after migration, refresh its schema cache from trusted SQL:

```sql
notify pgrst, 'reload schema';
```

Confirm **Data API** is enabled and the `public` schema is exposed. Leave `private` unexposed. Confirm both `anon` and `authenticated` have `USAGE` on `public` (the Supabase default). Do not expose `auth.users` as a public view.

To review table security:

```sql
select tablename, rowsecurity from pg_tables where schemaname='public';
select schemaname, tablename, policyname, roles, cmd from pg_policies where schemaname='public';
select * from pg_publication_tables where pubname='supabase_realtime';
```

The latest schema has six public BUSTRA tables plus a private role audit table, all with RLS enabled. Anonymous clients must not have SELECT grants on profiles, trips, or pickup_requests. A narrow security-definer public_feed function explicitly selects safe public fields; it never returns driver/creator identities or request rows. Staff Realtime subscriptions read private rows under RLS. Guests poll the projection every 15 seconds and subscribe only to public-safe location changes.

The last active Admin is protected against removal/demotion by a trigger and serialized role operations. Other active Admins may be demoted after explicit confirmation through User Management. See [role management](role-management.md) for the latest migration and audit safeguards. Before deleting any other account through trusted Auth administration, revoke its sessions, finish/reassign its trips, and review request history and foreign-key dependencies. Existing JWTs may remain usable until expiry; application operations recheck the current database profile role.

The management screens currently fetch at most 1,000 rows per category. Introduce server pagination, archival/retention rules, and a load-tested broadcast strategy before a large production fleet. This is documented scope, not an indication that all rows are loaded without limits.

For dynamic address/map selection, the latest additive migration is [`20261120055359_dynamic_schedule_locations.sql`](../supabase/migrations/20261120055359_dynamic_schedule_locations.sql), applied after the automatic-route upgrade. The current hosted project has already received it. It adds canonical endpoint coordinate fields and proximity-aware matching without deleting operational data. See [dynamic locations](dynamic-locations.md) for provider configuration, workflow and tests.
