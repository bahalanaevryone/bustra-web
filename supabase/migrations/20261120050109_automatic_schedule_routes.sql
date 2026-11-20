-- Additive upgrade: keep routes, trips.route_id, existing records, and all seven tables.
-- Review normalized duplicate endpoint pairs before applying; no records are merged/deleted.
begin;
create function private.place_key(value text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(trim(value), '\s+', ' ', 'g'));
$$;
do $$ begin
  if exists(select 1 from public.routes group by private.place_key(origin), private.place_key(destination) having count(*) > 1) then
    raise exception 'Duplicate origin/destination pairs exist. Review them and their trips/pickup points before applying this migration. No records have been changed.';
  end if;
end $$;
alter table public.routes drop constraint routes_route_name_check;
alter table public.routes add constraint routes_route_name_check check(length(trim(route_name)) between 1 and 330);
alter table public.routes
  add column origin_latitude numeric(9,6) check(origin_latitude between -90 and 90),
  add column origin_longitude numeric(9,6) check(origin_longitude between -180 and 180),
  add column destination_latitude numeric(9,6) check(destination_latitude between -90 and 90),
  add column destination_longitude numeric(9,6) check(destination_longitude between -180 and 180),
  add column is_approved boolean not null default false,
  add column road_path jsonb;
create unique index routes_endpoint_pair on public.routes(private.place_key(origin),private.place_key(destination));
-- A legacy stop pair supplies endpoint coordinates, never bus-road approval.
update public.routes r set
  origin_latitude=(select latitude from public.pickup_points where route_id=r.id and is_active order by stop_order,id limit 1),
  origin_longitude=(select longitude from public.pickup_points where route_id=r.id and is_active order by stop_order,id limit 1),
  destination_latitude=(select latitude from public.pickup_points where route_id=r.id and is_active order by stop_order desc,id desc limit 1),
  destination_longitude=(select longitude from public.pickup_points where route_id=r.id and is_active order by stop_order desc,id desc limit 1)
where (select count(*) from public.pickup_points where route_id=r.id and is_active) >= 2;

create function private.valid_road_path(path jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare p jsonb;
begin
  if path is null or jsonb_typeof(path) <> 'array' then return false; end if;
  if jsonb_array_length(path) not between 2 and 10000 then return false; end if;
  for p in select value from jsonb_array_elements(path) loop
    if jsonb_typeof(p) <> 'array' then return false; end if;
    if jsonb_array_length(p) <> 2 or jsonb_typeof(p->0) <> 'number' or jsonb_typeof(p->1) <> 'number' then return false; end if;
    if (p->>0)::numeric not between -90 and 90 or (p->>1)::numeric not between -180 and 180 then return false; end if;
  end loop;
  return true;
end $$;
-- Position along a reviewed road polyline, or NULL when farther than 100 metres.
-- Local equirectangular projection; appropriate for the service area, not global navigation.
create function private.road_position(path jsonb, lat numeric, lng numeric) returns double precision
language plpgsql immutable set search_path = '' as $$
declare i integer; ax double precision; ay double precision; bx double precision; by_ double precision;
  dx double precision; dy double precision; t double precision; d double precision; best double precision := 100.000001;
  progress double precision; scale double precision := 111195 * cos(radians(lat::double precision));
begin
  if not private.valid_road_path(path) or lat is null or lng is null then return null; end if;
  for i in 0..jsonb_array_length(path)-2 loop
    ax := ((path->i->>1)::double precision-lng)*scale; ay := ((path->i->>0)::double precision-lat)*111195;
    bx := ((path->(i+1)->>1)::double precision-lng)*scale; by_ := ((path->(i+1)->>0)::double precision-lat)*111195;
    dx := bx-ax; dy := by_-ay;
    if dx*dx+dy*dy = 0 then t := 0; else t := greatest(0,least(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))); end if;
    d := sqrt((ax+t*dx)^2+(ay+t*dy)^2);
    if d < best then best := d; progress := i+t; end if;
  end loop;
  return progress;
end $$;
alter table public.routes add constraint routes_road_path_valid check(road_path is null or private.valid_road_path(road_path));
alter table public.routes add constraint routes_approved_path_required check(not is_approved or road_path is not null);

create function private.prepare_route() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.pickup_points; current_position double precision; previous_position double precision := -1; stop_count integer := 0; previous_order integer := -1;
begin
  new.origin := regexp_replace(trim(new.origin),'\s+',' ','g');
  new.destination := regexp_replace(trim(new.destination),'\s+',' ','g');
  new.route_name := new.origin || ' → ' || new.destination;
  if tg_op = 'UPDATE' and row(new.origin,new.destination,new.origin_latitude,new.origin_longitude,new.destination_latitude,new.destination_longitude)
      is distinct from row(old.origin,old.destination,old.origin_latitude,old.origin_longitude,old.destination_latitude,old.destination_longitude) then
    new.is_approved := false; new.road_path := null;
  end if;
  if new.is_approved then
    if not private.valid_road_path(new.road_path) then raise exception 'Preview and review a road path before approving this bus route.'; end if;
    for p in select * from public.pickup_points where route_id=new.id and is_active order by stop_order,id for share loop
      current_position := private.road_position(new.road_path,p.latitude,p.longitude);
      if current_position is null or current_position < previous_position or p.stop_order = previous_order then
        raise exception 'Every active pickup point must lie within 100 m of the reviewed road path, in distinct stop order.';
      end if;
      previous_position := current_position; previous_order := p.stop_order; stop_count := stop_count+1;
    end loop;
    if stop_count < 2 then raise exception 'At least two active, ordered pickup points are required for route approval.'; end if;
    if new.origin_latitude is not null and (private.road_position(new.road_path,new.origin_latitude,new.origin_longitude) is null
       or private.road_position(new.road_path,new.destination_latitude,new.destination_longitude) is null) then
      raise exception 'The reviewed road path must include the route endpoints.';
    end if;
  end if;
  return new;
end $$;
create trigger prepare_route before insert or update on public.routes for each row execute function private.prepare_route();
update public.routes set route_name=origin || ' → ' || destination;

-- Any changed stop invalidates the reviewed path. Reapproval is deliberate.
create function private.invalidate_route_review() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and new is not distinct from old then return new; end if;
  if tg_op <> 'INSERT' then update public.routes set is_approved=false,road_path=null where id=old.route_id; end if;
  if tg_op <> 'DELETE' then update public.routes set is_approved=false,road_path=null where id=new.route_id; return new; end if;
  return old;
end $$;
create trigger invalidate_route_review after insert or update or delete on public.pickup_points for each row execute function private.invalidate_route_review();

create function private.place_coordinates(place text) returns table(latitude numeric, longitude numeric)
language plpgsql stable security definer set search_path = '' as $$
declare candidates jsonb;
begin
  select jsonb_agg(jsonb_build_array(c.lat,c.lng)) into candidates from (
    select p.latitude lat,p.longitude lng from public.pickup_points p where is_active and private.place_key(p.name)=private.place_key(place)
    union select origin_latitude,origin_longitude from public.routes where origin_latitude is not null and private.place_key(origin)=private.place_key(place)
    union select destination_latitude,destination_longitude from public.routes where destination_latitude is not null and private.place_key(destination)=private.place_key(place)
  ) c;
  if candidates is null then raise exception 'Choose a registered location with verified coordinates. Ask the administrator to register missing locations.'; end if;
  if exists(select 1 from jsonb_array_elements(candidates) c where abs((c->>0)::numeric-(candidates->0->>0)::numeric)>0.001 or abs((c->>1)::numeric-(candidates->0->>1)::numeric)>0.001) then
    raise exception 'This location name has conflicting coordinates. Ask the administrator to use distinct location names.';
  end if;
  return query select (candidates->0->>0)::numeric,(candidates->0->>1)::numeric;
end $$;

-- Preserve the original assignment, active-trip, capacity and lifecycle safeguards.
alter function public.manage_trip(uuid,jsonb) set schema private;
revoke all on function private.manage_trip(uuid,jsonb) from public,anon,authenticated;
create function public.manage_trip(p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller text := private.current_role(); route_uuid uuid; saved uuid; o text; d text;
  olat numeric; olng numeric; dlat numeric; dlng numeric; existing public.trips; initial_count integer;
begin
  if caller is null or caller not in ('employee','admin') then raise exception 'Staff access required.' using errcode='42501'; end if;
  if p_id is not null then
    select * into existing from public.trips where id=p_id for update;
    if not found then raise exception 'Trip not found.'; end if;
    if p_data ? 'initial_passenger_count' and (p_data->>'initial_passenger_count')::integer is distinct from existing.onboard_count then
      raise exception 'Initial passenger count is set only when creating a schedule. Use the assigned trip passenger controls afterwards.';
    end if;
  end if;
  if nullif(p_data->>'driver_id','') is null then raise exception 'Choose an assigned driver.'; end if;
  if p_data ? 'origin' or p_data ? 'destination' then
    o := regexp_replace(trim(p_data->>'origin'),'\s+',' ','g'); d := regexp_replace(trim(p_data->>'destination'),'\s+',' ','g');
    if o is null or d is null or length(o) not between 1 and 160 or length(d) not between 1 and 160 or private.place_key(o)=private.place_key(d) then
      raise exception 'Choose different registered origin and destination locations.';
    end if;
    select id into route_uuid from public.routes where private.place_key(origin)=private.place_key(o) and private.place_key(destination)=private.place_key(d);
    if route_uuid is null then
      select latitude,longitude into olat,olng from private.place_coordinates(o);
      select latitude,longitude into dlat,dlng from private.place_coordinates(d);
      insert into public.routes(origin,destination,origin_latitude,origin_longitude,destination_latitude,destination_longitude)
        values(o,d,olat,olng,dlat,dlng) on conflict do nothing returning id into route_uuid;
      -- A separate statement sees a concurrently inserted matching pair at READ COMMITTED.
      if route_uuid is null then select id into route_uuid from public.routes where private.place_key(origin)=private.place_key(o) and private.place_key(destination)=private.place_key(d); end if;
    end if;
  else
    -- Compatibility for lifecycle actions and clients upgrading from route selection.
    route_uuid := (p_data->>'route_id')::uuid;
  end if;
  if route_uuid is null then raise exception 'Choose an origin and destination.'; end if;
  p_data := p_data || jsonb_build_object('route_id',route_uuid,'status',coalesce(p_data->>'status',existing.status,'scheduled'));
  saved := private.manage_trip(p_id,p_data);
  if p_id is null then
    initial_count := coalesce((p_data->>'initial_passenger_count')::integer,0);
    update public.trips set onboard_count=initial_count where id=saved;
  end if;
  return saved;
end $$;

alter function public.admin_save(text,uuid,jsonb) set schema private;
revoke all on function private.admin_save(text,uuid,jsonb) from public,anon,authenticated;
create function public.admin_save(p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare saved uuid;
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Administrator access required.' using errcode='42501'; end if;
  saved := private.admin_save(p_entity,p_id,p_data);
  if p_entity='routes' then
    update public.routes set is_approved=coalesce((p_data->>'is_approved')::boolean,false),road_path=nullif(p_data->'road_path','null'::jsonb) where id=saved;
  end if;
  return saved;
end $$;

alter function public.request_pickup(uuid,uuid) set schema private;
revoke all on function private.request_pickup(uuid,uuid) from public,anon,authenticated;
create function public.request_pickup(p_trip uuid,p_point uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.trips; r public.routes; p public.pickup_points;
begin
  if auth.uid() is null or private.current_role() is distinct from 'user' then raise exception 'Sign in with a passenger account to request pickup.' using errcode='42501'; end if;
  select * into t from public.trips where id=p_trip for share;
  if not found or t.status <> 'active' then raise exception 'This trip is no longer active.'; end if;
  select * into r from public.routes where id=t.route_id for share;
  select * into p from public.pickup_points where id=p_point and route_id=t.route_id and is_active for share;
  if not found then raise exception 'Choose an active pickup point on this trip route.'; end if;
  if not r.is_approved or private.road_position(r.road_path,p.latitude,p.longitude) is null then raise exception 'This bus route and its pickup points are awaiting operator approval.'; end if;
  return private.request_pickup(p_trip,p_point);
end $$;
alter function public.respond_pickup(uuid,text) set schema private;
revoke all on function private.respond_pickup(uuid,text) from public,anon,authenticated;
create function public.respond_pickup(p_request uuid,p_status text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips; r public.routes; p public.pickup_points;
begin
  select trips.* into t from public.trips trips join public.pickup_requests q on q.trip_id=trips.id where q.id=p_request for share of trips;
  if not found or private.current_role() is distinct from 'employee' or t.driver_id is distinct from auth.uid() then raise exception 'Only the assigned active-trip employee can respond.' using errcode='42501'; end if;
  if p_status='accepted' then
    select * into r from public.routes where id=t.route_id for share;
    select stops.* into p from public.pickup_points stops join public.pickup_requests q on q.pickup_point_id=stops.id where q.id=p_request and stops.route_id=t.route_id and stops.is_active for share of stops;
    if not found or not r.is_approved or private.road_position(r.road_path,p.latitude,p.longitude) is null then raise exception 'This pickup point or route is no longer approved.'; end if;
  end if;
  perform private.respond_pickup(p_request,p_status);
end $$;

revoke all on function private.place_key(text),private.valid_road_path(jsonb),private.road_position(jsonb,numeric,numeric),private.prepare_route(),private.invalidate_route_review(),private.place_coordinates(text) from public,anon,authenticated;
revoke all on function public.manage_trip(uuid,jsonb),public.admin_save(text,uuid,jsonb),public.request_pickup(uuid,uuid),public.respond_pickup(uuid,text) from public,anon,authenticated;
grant execute on function public.manage_trip(uuid,jsonb),public.admin_save(text,uuid,jsonb),public.request_pickup(uuid,uuid),public.respond_pickup(uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
