-- Passenger-selected, one-time pickup coordinates. Preserve requests and retire
-- the operator pickup-point catalog only after backfill/dependency checks.
begin;
alter table public.routes add column legacy_pickup_points jsonb not null default '[]'::jsonb;
update public.routes r set legacy_pickup_points=coalesce((select jsonb_agg(to_jsonb(p) order by p.stop_order,p.id) from public.pickup_points p where p.route_id=r.id),'[]'::jsonb);
alter table public.pickup_requests
  add column pickup_latitude numeric(9,6) check(pickup_latitude between -90 and 90),
  add column pickup_longitude numeric(9,6) check(pickup_longitude between -180 and 180),
  add column pickup_address text check(pickup_address is null or length(pickup_address)<=500),
  add column route_verification text not null default 'unverified' check(route_verification in ('near_reviewed_route','near_suggested_route','unverified')),
  add column route_distance_m numeric check(route_distance_m>=0),
  add column response_note text check(response_note is null or length(response_note)<=300);
update public.pickup_requests q set pickup_latitude=p.latitude,pickup_longitude=p.longitude,pickup_address=p.name from public.pickup_points p where q.pickup_point_id=p.id;
do $$ begin
  if exists(select 1 from public.pickup_requests where pickup_latitude is null or pickup_longitude is null) then
    raise exception 'Some existing pickup requests could not be migrated. Review their referenced stops before retrying. No data has been removed.';
  end if;
end $$;
alter table public.pickup_requests alter column pickup_latitude set not null,alter column pickup_longitude set not null;
drop index public.one_open_request;
-- Preserve every legacy row; retain one open request per passenger/trip.
with ranked as (select id,row_number() over(partition by user_id,trip_id order by (status='accepted') desc,requested_at,id) n from public.pickup_requests where status in ('pending','accepted'))
update public.pickup_requests q set status='expired',responded_at=coalesce(q.responded_at,now()),response_note='Duplicate legacy open request retained as history during pickup migration.' from ranked r where q.id=r.id and r.n>1;
alter table public.pickup_requests drop column pickup_point_id;
create unique index one_open_request_per_trip on public.pickup_requests(user_id,trip_id) where status in ('pending','accepted');

create function private.valid_pickup_coordinates(lat numeric,lng numeric) returns boolean language sql immutable set search_path='' as $$
  select lat is not null and lng is not null and lat between -90 and 90 and lng between -180 and 180;
$$;
create function private.pickup_route_distance(path jsonb,lat numeric,lng numeric) returns numeric language plpgsql immutable set search_path='' as $$
declare i integer; ax double precision; ay double precision; bx double precision; by_ double precision; dx double precision; dy double precision; t double precision; d double precision; best double precision; scale double precision:=111195*cos(radians(lat::double precision));
begin
  if not private.valid_pickup_coordinates(lat,lng) or not private.valid_road_path(path) then return null; end if;
  for i in 0..jsonb_array_length(path)-2 loop
    ax:=((path->i->>1)::double precision-lng)*scale;ay:=((path->i->>0)::double precision-lat)*111195;
    bx:=((path->(i+1)->>1)::double precision-lng)*scale;by_:=((path->(i+1)->>0)::double precision-lat)*111195;
    dx:=bx-ax;dy:=by_-ay;
    if dx*dx+dy*dy=0 then t:=0;else t:=greatest(0,least(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy)));end if;
    d:=sqrt((ax+t*dx)^2+(ay+t*dy)^2);
    if best is null or d<best then best:=d;end if;
  end loop;
  return round(best::numeric,1);
end $$;
create function private.pickup_assessment(p_route uuid,lat numeric,lng numeric) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.routes; distance numeric; verification text;
begin
  if not private.valid_pickup_coordinates(lat,lng) then raise exception 'Choose a valid pickup position on the map.';end if;
  select * into r from public.routes where id=p_route;
  distance:=private.pickup_route_distance(r.road_path,lat,lng);
  verification:=case when distance is null then 'unverified' when distance>500 then 'too_far' when r.is_approved then 'near_reviewed_route' else 'near_suggested_route' end;
  return jsonb_build_object('verification',verification,'distance_m',distance,'can_request',verification<>'too_far');
end $$;
create function public.check_pickup_location(p_trip uuid,p_latitude numeric,p_longitude numeric) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.trips;
begin
  if auth.uid() is null or private.current_role() is distinct from 'user' then raise exception 'Sign in with a passenger account to request pickup.' using errcode='42501';end if;
  select * into t from public.trips where id=p_trip and status='active';
  if not found then raise exception 'This bus trip is no longer active.';end if;
  return private.pickup_assessment(t.route_id,p_latitude,p_longitude);
end $$;

drop function public.request_pickup(uuid,uuid);
drop function private.request_pickup(uuid,uuid);
create function public.request_pickup(p_trip uuid,p_latitude numeric,p_longitude numeric,p_address text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.trips; assessment jsonb; saved uuid; capacity_now integer;
begin
  perform 1 from public.profiles where id=auth.uid() and role='user' for update;
  if not found then raise exception 'Sign in with a passenger account to request pickup.' using errcode='42501';end if;
  if not private.valid_pickup_coordinates(p_latitude,p_longitude) then raise exception 'Choose a valid pickup position on the map.';end if;
  if length(p_address)>500 then raise exception 'Pickup address or label must be at most 500 characters.';end if;
  select * into t from public.trips where id=p_trip for update;
  if not found or t.status<>'active' then raise exception 'This bus trip is no longer active.';end if;
  perform 1 from public.routes where id=t.route_id for share;
  select capacity into capacity_now from public.buses where id=t.bus_id;
  if t.onboard_count>=capacity_now then raise exception 'This bus is currently full. Choose another bus or try again later.';end if;
  assessment:=private.pickup_assessment(t.route_id,p_latitude,p_longitude);
  if not (assessment->>'can_request')::boolean then raise exception 'This pickup is more than 500 metres from the stored road path. Move the pin closer to the bus route.';end if;
  if (select count(*) from public.pickup_requests where user_id=auth.uid() and status='pending')>=5 then raise exception 'You already have five pending requests. Cancel unused requests first.';end if;
  insert into public.pickup_requests(trip_id,user_id,pickup_latitude,pickup_longitude,pickup_address,route_verification,route_distance_m)
    values(p_trip,auth.uid(),p_latitude,p_longitude,nullif(trim(p_address),''),assessment->>'verification',(assessment->>'distance_m')::numeric) returning id into saved;
  return saved;
exception when unique_violation then raise exception 'You already have an open pickup request for this bus. Cancel it before choosing another position.';
end $$;
drop function public.respond_pickup(uuid,text);
drop function private.respond_pickup(uuid,text);
create function public.respond_pickup(p_request uuid,p_status text,p_safe_to_respond boolean default false,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
declare t public.trips; q public.pickup_requests; assessment jsonb; capacity_now integer;
begin
  if p_status is null or p_status not in ('accepted','rejected') then raise exception 'Choose accept or reject.';end if;
  if length(p_reason)>300 then raise exception 'Response note must be at most 300 characters.';end if;
  select trips.* into t from public.trips trips join public.pickup_requests r on r.trip_id=trips.id where r.id=p_request for update of trips;
  if not found or private.current_role() is distinct from 'employee' or t.driver_id is distinct from auth.uid() or t.status<>'active' then raise exception 'Only the assigned active-trip employee can respond.' using errcode='42501';end if;
  if p_safe_to_respond is distinct from true then raise exception 'Confirm that you are safely stopped before responding to pickup requests.';end if;
  select * into q from public.pickup_requests where id=p_request for update;
  if q.status<>'pending' then raise exception 'This request has already been handled.';end if;
  perform 1 from public.routes where id=t.route_id for share;
  assessment:=private.pickup_assessment(t.route_id,q.pickup_latitude,q.pickup_longitude);
  if p_status='accepted' then
    select capacity into capacity_now from public.buses where id=t.bus_id;
    if t.onboard_count>=capacity_now then raise exception 'The bus is full. Reject this request or update the passenger count when appropriate.';end if;
    if not (assessment->>'can_request')::boolean then raise exception 'This pickup is now too far from the stored road path. Reject it or ask the passenger to select another position.';end if;
  end if;
  update public.pickup_requests set status=p_status,responded_at=now(),response_note=nullif(trim(p_reason),''),
    route_verification=case when assessment->>'verification'='too_far' then route_verification else assessment->>'verification' end,route_distance_m=(assessment->>'distance_m')::numeric where id=p_request;
  -- Acceptance never reserves a seat or increments onboard_count.
end $$;
create or replace function public.cancel_pickup(p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.trips;
begin
  select trips.* into t from public.trips trips join public.pickup_requests q on q.trip_id=trips.id where q.id=p_request and q.user_id=auth.uid() for share of trips;
  if not found or t.status<>'active' then raise exception 'Only your open request on an active trip can be cancelled.';end if;
  update public.pickup_requests set status='cancelled',responded_at=now() where id=p_request and user_id=auth.uid() and status in ('pending','accepted');
  if not found then raise exception 'Only your own pending or accepted request can be cancelled.';end if;
end $$;
drop policy requests_private on public.pickup_requests;
create policy requests_private on public.pickup_requests for select to authenticated using(
  user_id=(select auth.uid()) or ((select private.current_role())='employee' and private.owns_trip(trip_id))
);

-- Route review is independent of passenger pin selection. No catalog is required.
create or replace function private.prepare_route() returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.origin:=regexp_replace(trim(new.origin),'\s+',' ','g');new.destination:=regexp_replace(trim(new.destination),'\s+',' ','g');new.route_name:=new.origin||' → '||new.destination;
  if tg_op='UPDATE' and row(new.origin,new.destination,new.origin_latitude,new.origin_longitude,new.destination_latitude,new.destination_longitude) is distinct from row(old.origin,old.destination,old.origin_latitude,old.origin_longitude,old.destination_latitude,old.destination_longitude) then new.is_approved:=false;new.road_path:=null;end if;
  if new.is_approved then
    if not private.valid_road_path(new.road_path) then raise exception 'Review a valid road path before approving this bus route.';end if;
    if new.origin_latitude is not null and (private.road_position(new.road_path,new.origin_latitude,new.origin_longitude) is null or private.road_position(new.road_path,new.destination_latitude,new.destination_longitude) is null) then raise exception 'The reviewed road path must include the route endpoints.';end if;
  end if;
  return new;
end $$;
create or replace function private.place_coordinates(place text) returns table(latitude numeric,longitude numeric) language plpgsql stable security definer set search_path='' as $$
declare candidates jsonb;
begin
  select jsonb_agg(jsonb_build_array(c.lat,c.lng)) into candidates from (
    select origin_lat lat,origin_lng lng from public.routes where origin_lat is not null and private.place_key(origin)=private.place_key(place)
    union select destination_lat,destination_lng from public.routes where destination_lat is not null and private.place_key(destination)=private.place_key(place)
  ) c;
  if candidates is null then raise exception 'Select and confirm the location coordinates on the map.';end if;
  if exists(select 1 from jsonb_array_elements(candidates) c where abs((c->>0)::numeric-(candidates->0->>0)::numeric)>0.001 or abs((c->>1)::numeric-(candidates->0->>1)::numeric)>0.001) then raise exception 'This label identifies several positions. Select the location coordinates.';end if;
  return query select (candidates->0->>0)::numeric,(candidates->0->>1)::numeric;
end $$;
create or replace function private.admin_save(p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Administrator access required.' using errcode='42501';end if;
  case p_entity
    when 'buses' then
      if p_id is null then insert into public.buses(plate_number,capacity) values(trim(p_data->>'plate_number'),(p_data->>'capacity')::integer) returning id into saved;
      else update public.buses set plate_number=trim(p_data->>'plate_number'),capacity=(p_data->>'capacity')::integer where id=p_id returning id into saved;end if;
    when 'routes' then
      if p_id is null then insert into public.routes(origin,destination) values(trim(p_data->>'origin'),trim(p_data->>'destination')) returning id into saved;
      else update public.routes set origin=trim(p_data->>'origin'),destination=trim(p_data->>'destination') where id=p_id returning id into saved;end if;
    when 'profiles' then
      if p_id is null then raise exception 'Accounts must register through the shared registration page.';end if;
      update public.profiles set first_name=trim(p_data->>'first_name'),last_name=trim(p_data->>'last_name') where id=p_id returning id into saved;
    else raise exception 'Unsupported record type.';
  end case;
  if saved is null then raise exception 'Record not found.';end if;return saved;
end $$;
create or replace function public.admin_delete(p_entity text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if private.current_role() is distinct from 'admin' then raise exception 'Administrator access required.' using errcode='42501';end if;
  case p_entity
    when 'buses' then delete from public.buses where id=p_id;
    when 'routes' then delete from public.routes where id=p_id;
    when 'trips' then
      if exists(select 1 from public.trips where id=p_id and status='active') then raise exception 'End the active trip before deleting it.';end if;
      delete from public.trips where id=p_id;
    when 'profiles' then raise exception 'Use trusted Auth administration for account deletion.';
    else raise exception 'Unsupported record type.';
  end case;
  if not found then raise exception 'Record not found.';end if;
exception when foreign_key_violation then raise exception 'This record is in use. Retain it or remove its dependencies first.';
end $$;
create or replace function public.public_feed() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'buses',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'plate_number',b.plate_number,'capacity',b.capacity)) from public.buses b),'[]'::jsonb),
    'routes',coalesce((select jsonb_agg(to_jsonb(r)-'legacy_pickup_points') from public.routes r),'[]'::jsonb),
    'pickup_points','[]'::jsonb, -- Empty compatibility key for old cached clients; no table.
    'trips',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'bus_id',t.bus_id,'route_id',t.route_id,'departure_at',t.departure_at,'onboard_count',t.onboard_count,'status',t.status) order by t.departure_at) from public.trips t where t.status in ('scheduled','active','delayed') and (t.status='active' or t.departure_at between now()-interval '1 day' and now()+interval '30 days')),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(to_jsonb(l)) from public.bus_location l join public.trips t on t.id=l.trip_id where t.status='active'),'[]'::jsonb)
  );
$$;
drop trigger invalidate_route_review on public.pickup_points;
drop function private.invalidate_route_review();
-- Refuse unexpected dependencies rather than silently dropping additional objects.
do $$ begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosrc like '%public.pickup_points%') then
    raise exception 'An unexpected function still depends on the pickup point catalog. Review it before retiring the table.';
  end if;
end $$;
drop table public.pickup_points restrict;
-- Historical operator stops stay archived for the owner, outside browser reads.
revoke select on public.routes from anon,authenticated;
grant select(id,route_name,origin,destination,origin_lat,origin_lng,destination_lat,destination_lng,origin_latitude,origin_longitude,destination_latitude,destination_longitude,is_approved,road_path) on public.routes to anon,authenticated;
revoke all on function private.valid_pickup_coordinates(numeric,numeric),private.pickup_route_distance(jsonb,numeric,numeric),private.pickup_assessment(uuid,numeric,numeric) from public,anon,authenticated;
revoke all on function public.check_pickup_location(uuid,numeric,numeric),public.request_pickup(uuid,numeric,numeric,text),public.respond_pickup(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.check_pickup_location(uuid,numeric,numeric),public.request_pickup(uuid,numeric,numeric,text),public.respond_pickup(uuid,text,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
