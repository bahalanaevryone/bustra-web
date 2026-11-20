-- Run once, with trusted project-owner SQL Editor access, AFTER the migration.
-- First create and verify a normal account using the registration screen.
-- Replace the placeholder with that account's exact Auth UUID. Never use a broad email match.
begin;
do $$
declare target_id uuid := 'REPLACE_WITH_EXACT_AUTH_USER_UUID';
begin
  if exists(select 1 from public.profiles where role='admin') then
    raise exception 'An administrator already exists. Bootstrap is disabled.';
  end if;
  update public.profiles set role='admin' where id=target_id and role='user';
  if not found then raise exception 'Exact registered passenger profile not found.'; end if;
end $$;
commit;
-- Refresh the app; permissions are loaded from profiles, not editable signup metadata.
