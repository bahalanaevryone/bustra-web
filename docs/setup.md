# Project setup details

Apply the initial migration only after inspecting the target project's current schema. It is intentionally not a destructive reconciliation script. Use the SQL Editor workflow in the README; do not enable permissive policies to work around configuration errors.

If Auth accounts already existed before the profile trigger was installed, run this trusted, one-time backfill after reviewing those accounts. It forces all of them to the passenger role. Bootstrap the one admin separately using its exact UUID.

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

All seven BUSTRA tables must have RLS enabled. Anonymous clients must not have SELECT grants on profiles, trips, or pickup_requests. A narrow security-definer public_feed function explicitly selects safe public fields; it never returns driver/creator identities or request rows. Staff Realtime subscriptions read private rows under RLS. Guests poll the projection every 15 seconds and subscribe only to public-safe location changes.

Admin account deletion is intentionally protected by a trigger. To transfer ownership, design a separate trusted maintenance transaction with the project owner, an audit trail, and a backup; do not remove the protection for day-to-day operations. Before deleting any other account through trusted Auth administration, revoke its sessions, finish/reassign its trips, and review request history and foreign-key dependencies. Existing JWTs may remain usable until expiry; application operations recheck the current database profile role.

The management screens currently fetch at most 1,000 rows per category. Introduce server pagination, archival/retention rules, and a load-tested broadcast strategy before a large production fleet. This is documented scope, not an indication that all rows are loaded without limits.
