-- BUSTRA initial schema. Apply to a fresh Supabase project after reviewing existing data.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null check (length(trim(last_name)) between 1 and 80),
  role text not null default 'user' check (role in ('user','employee','admin')),
  created_at timestamptz not null default now()
);
create unique index one_administrator on public.profiles (role) where role = 'admin';
create index profiles_role on public.profiles(role);
create table public.buses (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique check(length(trim(plate_number)) between 1 and 30),
  capacity integer not null check (capacity between 1 and 200),
  created_at timestamptz not null default now()
);
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  route_name text not null check(length(trim(route_name)) between 1 and 160),
  origin text not null check(length(trim(origin)) between 1 and 160),
  destination text not null check(length(trim(destination)) between 1 and 160)
);
create table public.pickup_points (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id),
  name text not null check(length(trim(name)) between 1 and 160),
  latitude numeric(9,6) not null check(latitude between -90 and 90),
  longitude numeric(9,6) not null check(longitude between -180 and 180),
  stop_order integer not null default 0 check(stop_order >= 0),
  is_active boolean not null default true
);
create index pickup_points_route on public.pickup_points(route_id, stop_order);
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  bus_id uuid not null references public.buses(id),
  route_id uuid not null references public.routes(id),
  driver_id uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  departure_at timestamptz not null,
  onboard_count integer not null default 0 check(onboard_count >= 0),
  status text not null default 'scheduled' check(status in ('scheduled','active','completed','cancelled','delayed')),
  created_at timestamptz not null default now()
);
create unique index one_active_bus on public.trips(bus_id) where status = 'active';
create unique index one_active_driver on public.trips(driver_id) where status = 'active';
create index trips_departure on public.trips(departure_at);
create index trips_driver on public.trips(driver_id);
create index trips_creator on public.trips(created_by);
create index trips_route on public.trips(route_id);
create table public.bus_location (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  latitude numeric(9,6) not null check(latitude between -90 and 90),
  longitude numeric(9,6) not null check(longitude between -180 and 180),
  updated_at timestamptz not null default now(),
  speed_kmh numeric check(speed_kmh between 0 and 200),
  accuracy_m numeric check(accuracy_m between 0 and 100000)
);
create table public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  user_id uuid not null references public.profiles(id),
  pickup_point_id uuid not null references public.pickup_points(id),
  status text not null default 'pending' check(status in ('pending','accepted','rejected','cancelled','expired')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index one_open_request on public.pickup_requests(user_id, trip_id, pickup_point_id) where status in ('pending','accepted');
create index requests_user on public.pickup_requests(user_id, requested_at desc);
create index requests_trip on public.pickup_requests(trip_id, status);
create index requests_point on public.pickup_requests(pickup_point_id);

create function private.current_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid());
$$;
create function private.is_active_trip(p_trip uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.trips where id = p_trip and status = 'active');
$$;
create function private.owns_trip(p_trip uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.trips where id = p_trip and driver_id = (select auth.uid()));
$$;
create function private.handle_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, first_name, last_name, role)
  values(new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'first_name'),''),'Passenger'),80),
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'last_name'),''),'Account'),80), 'user');
  return new;
end;
$$;
create trigger create_profile after insert on auth.users for each row execute function private.handle_signup();

create function private.protect_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin' or new.id <> old.id) then
    raise exception 'The sole administrator cannot be deleted or demoted.';
  end if;
  if tg_op = 'UPDATE' and old.role = 'employee' and new.role <> 'employee' and exists(select 1 from public.trips where driver_id = old.id and status in ('scheduled','active','delayed')) then
    raise exception 'Reassign unfinished trips before changing this employee role.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger protect_profile before update or delete on public.profiles for each row execute function private.protect_profile();

create function private.validate_trip() returns trigger language plpgsql security definer set search_path = '' as $$
declare maximum integer; assigned_role text;
begin
  select capacity into maximum from public.buses where id = new.bus_id for update;
  if maximum is null or new.onboard_count > maximum then raise exception 'Passenger count exceeds bus capacity.'; end if;
  if new.driver_id is not null then
    select role into assigned_role from public.profiles where id = new.driver_id for share;
    if assigned_role is distinct from 'employee' then raise exception 'Assigned driver must be an employee.'; end if;
  elsif new.status = 'active' then raise exception 'An active trip needs an assigned employee.';
  end if;
  return new;
end;
$$;
create trigger validate_trip before insert or update on public.trips for each row execute function private.validate_trip();
create function private.validate_capacity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.trips where bus_id = new.id and onboard_count > new.capacity) then
    raise exception 'Capacity cannot be lower than a recorded passenger count.';
  end if;
  return new;
end;
$$;
create trigger validate_capacity before update of capacity on public.buses for each row execute function private.validate_capacity();
create function private.finish_requests() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('completed','cancelled') and old.status is distinct from new.status then
    update public.pickup_requests set status = 'expired', responded_at = now() where trip_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;
create trigger finish_requests after update of status on public.trips for each row execute function private.finish_requests();

-- No anonymous reads of private trip/profile/request rows. Public RPC projects explicit fields.
alter table public.profiles enable row level security;
alter table public.buses enable row level security;
alter table public.routes enable row level security;
alter table public.pickup_points enable row level security;
alter table public.trips enable row level security;
alter table public.bus_location enable row level security;
alter table public.pickup_requests enable row level security;
revoke all on public.profiles, public.buses, public.routes, public.pickup_points, public.trips, public.bus_location, public.pickup_requests from anon, authenticated;
grant select on public.buses, public.routes, public.pickup_points, public.bus_location to anon, authenticated;
grant select on public.profiles, public.trips, public.pickup_requests to authenticated;
grant update(first_name,last_name) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid()) or (select private.current_role()) = 'admin' or ((select private.current_role()) = 'employee' and role = 'employee')
);
create policy profiles_update_names on public.profiles for update to authenticated using(id = (select auth.uid())) with check(id = (select auth.uid()));
create policy buses_public on public.buses for select to anon, authenticated using(true);
create policy routes_public on public.routes for select to anon, authenticated using(true);
create policy points_public on public.pickup_points for select to anon, authenticated using(is_active or (select private.current_role()) = 'admin');
create policy trips_staff on public.trips for select to authenticated using((select private.current_role()) in ('employee','admin'));
create policy location_public on public.bus_location for select to anon, authenticated using(private.is_active_trip(trip_id));
create policy requests_private on public.pickup_requests for select to authenticated using(
  user_id = (select auth.uid()) or (select private.current_role()) = 'admin' or ((select private.current_role()) = 'employee' and private.owns_trip(trip_id))
);

create function public.public_feed() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'buses', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'plate_number',b.plate_number,'capacity',b.capacity)) from public.buses b),'[]'::jsonb),
    'routes', coalesce((select jsonb_agg(to_jsonb(r)) from public.routes r),'[]'::jsonb),
    'pickup_points', coalesce((select jsonb_agg(to_jsonb(p) order by p.stop_order) from public.pickup_points p where p.is_active),'[]'::jsonb),
    'trips', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'bus_id',t.bus_id,'route_id',t.route_id,'departure_at',t.departure_at,'onboard_count',t.onboard_count,'status',t.status) order by t.departure_at) from public.trips t where t.status in ('scheduled','active','delayed') and (t.status = 'active' or t.departure_at between now() - interval '1 day' and now() + interval '30 days')),'[]'::jsonb),
    'locations', coalesce((select jsonb_agg(to_jsonb(l)) from public.bus_location l join public.trips t on t.id = l.trip_id where t.status = 'active'),'[]'::jsonb)
  );
$$;

create function public.manage_trip(p_id uuid, p_data jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller text := private.current_role(); existing public.trips; saved uuid;
begin
  if caller is null or caller not in ('employee','admin') then raise exception 'Staff access required.' using errcode = '42501'; end if;
  if p_id is not null then
    select * into existing from public.trips where id = p_id for update;
    if not found then raise exception 'Trip not found.'; end if;
    if existing.status in ('completed','cancelled') then raise exception 'Finished trips cannot be edited.'; end if;
    if existing.status = 'active' then
      if caller <> 'admin' and existing.driver_id <> auth.uid() then raise exception 'Only the assigned employee can end this active trip.' using errcode = '42501'; end if;
      if (p_data->>'bus_id')::uuid is distinct from existing.bus_id or (p_data->>'route_id')::uuid is distinct from existing.route_id or nullif(p_data->>'driver_id','')::uuid is distinct from existing.driver_id or (p_data->>'departure_at')::timestamptz is distinct from existing.departure_at then
        raise exception 'End the active trip before changing its assignment or schedule.';
      end if;
    end if;
    if p_data->>'status' = 'active' and caller <> 'admin' and nullif(p_data->>'driver_id','')::uuid is distinct from auth.uid() then raise exception 'Only the assigned employee can start a trip.' using errcode = '42501'; end if;
    update public.trips set bus_id = (p_data->>'bus_id')::uuid, route_id = (p_data->>'route_id')::uuid, driver_id = nullif(p_data->>'driver_id','')::uuid, departure_at = (p_data->>'departure_at')::timestamptz, status = p_data->>'status' where id = p_id returning id into saved;
  else
    if p_data->>'status' = 'active' and caller <> 'admin' and nullif(p_data->>'driver_id','')::uuid is distinct from auth.uid() then raise exception 'Only the assigned employee can start a trip.' using errcode = '42501'; end if;
    insert into public.trips(bus_id,route_id,driver_id,created_by,departure_at,status) values((p_data->>'bus_id')::uuid,(p_data->>'route_id')::uuid,nullif(p_data->>'driver_id','')::uuid,auth.uid(),(p_data->>'departure_at')::timestamptz,coalesce(p_data->>'status','scheduled')) returning id into saved;
  end if;
  return saved;
end;
$$;

create function public.adjust_passengers(p_trip uuid, p_delta integer) returns integer language plpgsql security definer set search_path = '' as $$
declare current_trip public.trips; count_now integer;
begin
  if p_delta is null or p_delta not in (-1,1) then raise exception 'Adjustment must be +1 or -1.'; end if;
  select * into current_trip from public.trips where id = p_trip for update;
  if not found or private.current_role() is distinct from 'employee' or current_trip.driver_id is distinct from auth.uid() or current_trip.status <> 'active' then
    raise exception 'Only the assigned employee can count passengers on an active trip.' using errcode = '42501';
  end if;
  update public.trips set onboard_count = onboard_count + p_delta where id = p_trip returning onboard_count into count_now;
  return count_now;
end;
$$;

create function public.publish_location(p_trip uuid, p_lat numeric, p_lng numeric, p_speed numeric default null, p_accuracy numeric default null) returns void language plpgsql security definer set search_path = '' as $$
declare current_trip public.trips;
begin
  select * into current_trip from public.trips where id = p_trip for share;
  if not found or private.current_role() is distinct from 'employee' or current_trip.driver_id is distinct from auth.uid() or current_trip.status <> 'active' then
    raise exception 'Only the assigned employee can share location for an active trip.' using errcode = '42501';
  end if;
  insert into public.bus_location(trip_id,latitude,longitude,speed_kmh,accuracy_m,updated_at) values(p_trip,p_lat,p_lng,p_speed,p_accuracy,now())
  on conflict(trip_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,speed_kmh=excluded.speed_kmh,accuracy_m=excluded.accuracy_m,updated_at=now();
end;
$$;

create function public.request_pickup(p_trip uuid, p_point uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare current_trip public.trips; saved uuid;
begin
  if auth.uid() is null or private.current_role() is distinct from 'user' then raise exception 'Sign in with a passenger account to request pickup.' using errcode = '42501'; end if;
  select * into current_trip from public.trips where id = p_trip for share;
  if not found or current_trip.status <> 'active' then raise exception 'This trip is no longer active.'; end if;
  perform 1 from public.pickup_points where id=p_point and route_id=current_trip.route_id and is_active for share;
  if not found then raise exception 'Choose an active pickup point on this trip route.'; end if;
  if (select count(*) from public.pickup_requests where user_id=auth.uid() and status='pending') >= 5 then raise exception 'You already have five pending requests. Cancel unused requests first.'; end if;
  insert into public.pickup_requests(trip_id,user_id,pickup_point_id) values(p_trip,auth.uid(),p_point) returning id into saved;
  return saved;
exception when unique_violation then raise exception 'You already have an open request for this bus and pickup point.';
end;
$$;
create function public.cancel_pickup(p_request uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pickup_requests set status='cancelled',responded_at=now() where id=p_request and user_id=auth.uid() and status='pending';
  if not found then raise exception 'Only your own pending request can be cancelled.'; end if;
end;
$$;
create function public.respond_pickup(p_request uuid, p_status text) returns void language plpgsql security definer set search_path = '' as $$
declare request public.pickup_requests; current_trip public.trips;
begin
  if p_status is null or p_status not in ('accepted','rejected') then raise exception 'Choose accept or reject.'; end if;
  -- Consistent trip-before-request lock ordering with trip completion.
  select t.* into current_trip from public.trips t join public.pickup_requests r on r.trip_id=t.id where r.id=p_request for share of t;
  if not found or current_trip.status <> 'active' or private.current_role() is distinct from 'employee' or current_trip.driver_id is distinct from auth.uid() then raise exception 'Only the assigned active-trip employee can respond.' using errcode = '42501'; end if;
  select * into request from public.pickup_requests where id=p_request for update;
  if request.status <> 'pending' then raise exception 'This request has already been handled.'; end if;
  update public.pickup_requests set status=p_status,responded_at=now() where id=p_request;
  -- Acceptance deliberately does not change onboard_count.
end;
$$;

create function public.set_employee_role(p_user uuid, p_role text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('user','employee') then raise exception 'Only user and employee roles can be assigned here.'; end if;
  update public.profiles set role=p_role where id=p_user and role <> 'admin';
  if not found then raise exception 'Account not found or protected administrator.'; end if;
end;
$$;

create function public.admin_save(p_entity text, p_id uuid, p_data jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare saved uuid;
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  case p_entity
    when 'buses' then
      if p_id is null then insert into public.buses(plate_number,capacity) values(trim(p_data->>'plate_number'),(p_data->>'capacity')::integer) returning id into saved;
      else update public.buses set plate_number=trim(p_data->>'plate_number'),capacity=(p_data->>'capacity')::integer where id=p_id returning id into saved; end if;
    when 'routes' then
      if p_id is null then insert into public.routes(route_name,origin,destination) values(trim(p_data->>'route_name'),trim(p_data->>'origin'),trim(p_data->>'destination')) returning id into saved;
      else update public.routes set route_name=trim(p_data->>'route_name'),origin=trim(p_data->>'origin'),destination=trim(p_data->>'destination') where id=p_id returning id into saved; end if;
    when 'pickup_points' then
      if p_id is null then insert into public.pickup_points(route_id,name,latitude,longitude,stop_order,is_active) values((p_data->>'route_id')::uuid,trim(p_data->>'name'),(p_data->>'latitude')::numeric,(p_data->>'longitude')::numeric,(p_data->>'stop_order')::integer,coalesce((p_data->>'is_active')::boolean,true)) returning id into saved;
      else
        if exists(select 1 from public.pickup_requests where pickup_point_id=p_id) and exists(select 1 from public.pickup_points where id=p_id and route_id<>(p_data->>'route_id')::uuid) then raise exception 'A requested pickup point cannot move to another route.'; end if;
        update public.pickup_points set route_id=(p_data->>'route_id')::uuid,name=trim(p_data->>'name'),latitude=(p_data->>'latitude')::numeric,longitude=(p_data->>'longitude')::numeric,stop_order=(p_data->>'stop_order')::integer,is_active=coalesce((p_data->>'is_active')::boolean,true) where id=p_id returning id into saved;
      end if;
    when 'profiles' then
      if p_id is null then raise exception 'Accounts must register through the shared registration page.'; end if;
      update public.profiles set first_name=trim(p_data->>'first_name'),last_name=trim(p_data->>'last_name') where id=p_id returning id into saved;
    else raise exception 'Unsupported record type.';
  end case;
  if saved is null then raise exception 'Record not found.'; end if;
  return saved;
end;
$$;
create function public.admin_delete(p_entity text, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  case p_entity
    when 'buses' then delete from public.buses where id=p_id;
    when 'routes' then delete from public.routes where id=p_id;
    when 'pickup_points' then delete from public.pickup_points where id=p_id;
    when 'trips' then
      if exists(select 1 from public.trips where id=p_id and status='active') then raise exception 'End the active trip before deleting it.'; end if;
      delete from public.trips where id=p_id;
    when 'profiles' then raise exception 'Use the trusted Auth dashboard to delete accounts. Revoke sessions first. The sole admin is protected.';
    else raise exception 'Unsupported record type.';
  end case;
  if not found then raise exception 'Record not found.'; end if;
exception when foreign_key_violation then raise exception 'This record is in use. Retain it or remove its dependencies first.';
end;
$$;

-- Explicitly revoke default PUBLIC function execution, including helpers and triggers.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_role(), private.owns_trip(uuid) to authenticated;
grant execute on function private.current_role(), private.is_active_trip(uuid) to anon, authenticated;
revoke execute on function public.public_feed(), public.manage_trip(uuid,jsonb), public.adjust_passengers(uuid,integer), public.publish_location(uuid,numeric,numeric,numeric,numeric), public.request_pickup(uuid,uuid), public.cancel_pickup(uuid), public.respond_pickup(uuid,text), public.set_employee_role(uuid,text), public.admin_save(text,uuid,jsonb), public.admin_delete(text,uuid) from public, anon, authenticated;
grant execute on function public.public_feed() to anon, authenticated;
grant execute on function public.manage_trip(uuid,jsonb), public.adjust_passengers(uuid,integer), public.publish_location(uuid,numeric,numeric,numeric,numeric), public.request_pickup(uuid,uuid), public.cancel_pickup(uuid), public.respond_pickup(uuid,text), public.set_employee_role(uuid,text), public.admin_save(text,uuid,jsonb), public.admin_delete(text,uuid) to authenticated;

do $$
declare tab text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach tab in array array['profiles','trips','bus_location','pickup_requests'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then
        execute format('alter publication supabase_realtime add table public.%I',tab);
      end if;
    end loop;
  end if;
end $$;
commit;
