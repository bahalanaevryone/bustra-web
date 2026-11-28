-- Reversible list cleanup for ended schedules; no trip/request records removed.
begin;
alter table public.trips
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete set null,
  add constraint trips_archive_state check(
    (archived_at is null and archived_by is null)
    or (archived_at is not null and status in ('completed','cancelled'))
  );
create index trips_archived_by on public.trips(archived_by) where archived_by is not null;

-- Archive metadata must not revalidate a former driver's current account role.
-- Keep the original validator for inserts and every original operational field.
drop trigger validate_trip on public.trips;
create trigger validate_trip before insert or update of
  id,bus_id,route_id,driver_id,created_by,departure_at,onboard_count,status,created_at
on public.trips for each row execute function private.validate_trip();

create function private.archive_trip(p_trip uuid,p_archive boolean) returns void
language plpgsql security definer set search_path='' as $$
declare t public.trips;
begin
  if auth.uid() is null or not private.active_admin(auth.uid()) then
    raise exception 'Active administrator access required.' using errcode='42501';
  end if;
  if p_archive is null then raise exception 'Choose archive or restore.';end if;
  select * into t from public.trips where id=p_trip for update;
  if not found then raise exception 'Schedule not found.';end if;
  if not private.active_admin(auth.uid()) then
    raise exception 'Active administrator access required.' using errcode='42501';
  end if;
  if t.status not in ('completed','cancelled') then
    raise exception 'Only completed or cancelled schedules can be archived or restored.';
  end if;
  update public.trips set
    archived_at=case when p_archive then coalesce(archived_at,now()) else null end,
    archived_by=case when not p_archive then null when archived_at is null then auth.uid() else archived_by end
  where id=p_trip;
end $$;
create function public.archive_trip(p_trip uuid,p_archive boolean default true) returns void
language sql security invoker set search_path='' as $$
  select private.archive_trip(p_trip,p_archive);
$$;
revoke update(archived_at,archived_by) on public.trips from public,anon,authenticated;
revoke all on function private.archive_trip(uuid,boolean),public.archive_trip(uuid,boolean) from public,anon,authenticated;
grant execute on function private.archive_trip(uuid,boolean),public.archive_trip(uuid,boolean) to authenticated;

create or replace function public.admin_delete(p_entity text,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.trips;
begin
  if private.current_role() is distinct from 'admin' then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  case p_entity
    when 'buses' then delete from public.buses where id=p_id;
    when 'routes' then delete from public.routes where id=p_id;
    when 'trips' then
      select * into t from public.trips where id=p_id for update;
      if not found then raise exception 'Record not found.';end if;
      if t.status='active' then raise exception 'End the active trip before deleting it.';end if;
      if exists(select 1 from public.pickup_requests where trip_id=p_id) then
        if t.archived_at is not null then
          raise exception 'This archived schedule has pickup request history and cannot be permanently deleted. Keep it archived to retain the passenger records.';
        end if;
        raise exception 'This schedule has pickup request history. Use Archive to hide it while keeping the passenger records.';
      end if;
      delete from public.trips where id=p_id;
    when 'profiles' then raise exception 'Use trusted Auth administration for account deletion.';
    else raise exception 'Unsupported record type.';
  end case;
  if not found then raise exception 'Record not found.';end if;
exception when foreign_key_violation then
  if p_entity='trips' then
    raise exception 'This schedule is linked to other records. Use Archive to hide it while keeping its history.';
  end if;
  raise exception 'This record is in use. Retain it or remove its dependencies first.';
end $$;
notify pgrst,'reload schema';
commit;
