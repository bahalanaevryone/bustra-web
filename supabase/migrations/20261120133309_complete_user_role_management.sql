-- Multiple administrators, atomic role/name updates, and a private append-only audit.
-- Registration and the six public application tables are unchanged.
begin;

drop index public.one_administrator;

create table private.role_change_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  target_id uuid not null,
  old_role text check(old_role in ('user','employee','admin')),
  new_role text check(new_role in ('user','employee','admin')),
  changed_at timestamptz not null default clock_timestamp(),
  source text not null check(source in ('authenticated_admin','trusted_database'))
);
create index role_change_audit_recent on private.role_change_audit(changed_at desc,id desc);
alter table private.role_change_audit enable row level security;
revoke all on private.role_change_audit from public,anon,authenticated;
revoke all on sequence private.role_change_audit_id_seq from public,anon,authenticated;
-- No foreign keys: history survives later account deletion.

create function private.active_admin(p_user uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user and p.role='admin' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  );
$$;

create function private.lock_admin_roles() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('bustra.admin_roles',0));
  -- Lock a common, deterministic set before changing roles. Besides serializing
  -- READ COMMITTED calls, concurrent changes at stronger isolation must retry
  -- rather than relying on a stale administrator count.
  perform 1 from public.profiles where role='admin' order by id for update;
end $$;

create function private.serialize_profile_roles() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_admin_roles();
  return null;
end $$;
create trigger serialize_profile_roles before update of role or delete on public.profiles
for each statement execute function private.serialize_profile_roles();

create or replace function private.protect_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.id<>old.id then
    raise exception 'Profile identifiers cannot be changed.';
  end if;
  if old.role='admin' and (tg_op='DELETE' or new.role<>'admin') then
    if not exists(select 1 from public.profiles p where p.id<>old.id and p.role='admin' and private.active_admin(p.id)) then
      raise exception 'The last active administrator cannot be removed or demoted. Assign another active administrator first.';
    end if;
  end if;
  if tg_op='UPDATE' and old.role='employee' and new.role<>'employee'
     and exists(select 1 from public.trips where driver_id=old.id and status in ('scheduled','active','delayed')) then
    raise exception 'Reassign unfinished trips before changing this employee role.';
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end $$;

create function private.record_role_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    insert into private.role_change_audit(actor_id,target_id,old_role,new_role,source)
    values(auth.uid(),old.id,old.role,null,case when auth.uid() is null then 'trusted_database' else 'authenticated_admin' end);
    return old;
  end if;
  if new.role is distinct from old.role then
    insert into private.role_change_audit(actor_id,target_id,old_role,new_role,source)
    values(auth.uid(),new.id,old.role,new.role,case when auth.uid() is null then 'trusted_database' else 'authenticated_admin' end);
  end if;
  return new;
end $$;
create trigger record_role_change after update of role or delete on public.profiles
for each row execute function private.record_role_change();

create function private.admin_update_user(
  p_user uuid,p_first_name text,p_last_name text,p_role text,
  p_confirm_admin boolean,p_expected_role text
) returns void language plpgsql security definer set search_path='' as $$
declare previous_role text;
begin
  if auth.uid() is null or not private.active_admin(auth.uid()) then
    raise exception 'Active administrator access required.' using errcode='42501';
  end if;
  -- Authorize again after waiting, using the current database role, never JWT
  -- user_metadata or an editable role value submitted by the browser.
  perform private.lock_admin_roles();
  if auth.uid() is null or not private.active_admin(auth.uid()) then
    raise exception 'Active administrator access required.' using errcode='42501';
  end if;
  if p_role is null or p_role not in ('user','employee','admin') then
    raise exception 'Choose User, Employee, or Admin.';
  end if;
  select role into previous_role from public.profiles where id=p_user for update;
  if not found then raise exception 'Registered account not found.';end if;
  if p_expected_role is not null and previous_role<>p_expected_role then
    raise exception 'This account role changed since you opened it. Refresh User Management and review it again.';
  end if;
  if previous_role<>p_role and (previous_role='admin' or p_role='admin') and p_confirm_admin is distinct from true then
    raise exception 'Confirm before assigning or removing Admin privileges.';
  end if;
  if p_role='admin' and previous_role<>'admin' and not exists(
    select 1 from auth.users where id=p_user and deleted_at is null
      and (banned_until is null or banned_until<=now())
      and (email_confirmed_at is not null or phone_confirmed_at is not null)
  ) then
    raise exception 'Verify this account and remove any account ban before granting Admin access.';
  end if;
  if (p_first_name is not null and length(trim(p_first_name)) not between 1 and 80)
     or (p_last_name is not null and length(trim(p_last_name)) not between 1 and 80) then
    raise exception 'First and last names must each contain 1 to 80 characters.';
  end if;
  update public.profiles set role=p_role,
    first_name=coalesce(trim(p_first_name),first_name),last_name=coalesce(trim(p_last_name),last_name)
  where id=p_user;
end $$;

create function public.admin_update_user(
  p_user uuid,p_first_name text,p_last_name text,p_role text,
  p_confirm_admin boolean default false,p_expected_role text default null
) returns void language sql security invoker set search_path='' as $$
  select private.admin_update_user(p_user,p_first_name,p_last_name,p_role,p_confirm_admin,p_expected_role);
$$;

-- Cached older clients can still change User/Employee roles through this alias.
-- An Admin transition requires the new operation's explicit confirmation.
create or replace function public.set_employee_role(p_user uuid,p_role text) returns void
language sql security invoker set search_path='' as $$
  select private.admin_update_user(p_user,null,null,p_role,false,null);
$$;

create function private.role_change_history(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.active_admin(auth.uid()) then
    raise exception 'Active administrator access required.' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'History limit must be between 1 and 100.';end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.changed_at desc,a.id desc) from
    (select id,actor_id,target_id,old_role,new_role,changed_at,source from private.role_change_audit order by changed_at desc,id desc limit p_limit) a),'[]'::jsonb);
end $$;
create function public.role_change_history(p_limit integer default 30) returns jsonb
language sql security invoker set search_path='' as $$
  select private.role_change_history(p_limit);
$$;

-- Role columns remain non-writable through the Data API, even for Admin JWTs.
revoke update(role) on public.profiles from public,anon,authenticated;
revoke all on function private.active_admin(uuid),private.lock_admin_roles(),private.serialize_profile_roles(),private.record_role_change(),private.admin_update_user(uuid,text,text,text,boolean,text),private.role_change_history(integer) from public,anon,authenticated;
revoke all on function public.admin_update_user(uuid,text,text,text,boolean,text),public.set_employee_role(uuid,text),public.role_change_history(integer) from public,anon,authenticated;
-- Invoker wrappers need execution permission on these unexposed, guarded
-- implementations. They perform identical checks when invoked directly.
grant execute on function private.admin_update_user(uuid,text,text,text,boolean,text),private.role_change_history(integer) to authenticated;
grant execute on function public.admin_update_user(uuid,text,text,text,boolean,text),public.set_employee_role(uuid,text),public.role_change_history(integer) to authenticated;
notify pgrst,'reload schema';
commit;
