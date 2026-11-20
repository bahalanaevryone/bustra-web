-- Dynamic endpoints: additive, no table or data deletion.
begin;
alter table public.routes
  add column origin_lat numeric(9,6) check(origin_lat between -90 and 90),
  add column origin_lng numeric(9,6) check(origin_lng between -180 and 180),
  add column destination_lat numeric(9,6) check(destination_lat between -90 and 90),
  add column destination_lng numeric(9,6) check(destination_lng between -180 and 180);
-- Retain the previous coordinate columns for old clients/functions during rollout.
update public.routes set origin_lat=origin_latitude,origin_lng=origin_longitude,
  destination_lat=destination_latitude,destination_lng=destination_longitude;
alter table public.routes drop constraint routes_origin_check,drop constraint routes_destination_check,drop constraint routes_route_name_check;
alter table public.routes add constraint routes_origin_check check(length(trim(origin)) between 1 and 500),
  add constraint routes_destination_check check(length(trim(destination)) between 1 and 500),
  add constraint routes_route_name_check check(length(trim(route_name)) between 1 and 1010);
drop index public.routes_endpoint_pair;
create index routes_endpoint_lookup on public.routes(private.place_key(origin),private.place_key(destination));
-- Unlocated legacy/admin placeholders remain unique, while equal labels at distant
-- coordinates are allowed. Located identity is checked under an advisory lock below.
create unique index routes_unlocated_pair on public.routes(private.place_key(origin),private.place_key(destination))
  where origin_lat is null or origin_lng is null or destination_lat is null or destination_lng is null;
create function private.endpoint_distance(a_lat numeric,a_lng numeric,b_lat numeric,b_lng numeric)
returns double precision language sql immutable set search_path = '' as $$
  select 12742000 * asin(sqrt(least(1.0,greatest(0.0,
    sin(radians((b_lat-a_lat)::double precision)/2)^2 + cos(radians(a_lat::double precision))*cos(radians(b_lat::double precision))*sin(radians((b_lng-a_lng)::double precision)/2)^2))));
$$;
create function private.sync_route_coordinates() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    new.origin_lat := coalesce(new.origin_lat,new.origin_latitude); new.origin_latitude := new.origin_lat;
    new.origin_lng := coalesce(new.origin_lng,new.origin_longitude); new.origin_longitude := new.origin_lng;
    new.destination_lat := coalesce(new.destination_lat,new.destination_latitude); new.destination_latitude := new.destination_lat;
    new.destination_lng := coalesce(new.destination_lng,new.destination_longitude); new.destination_longitude := new.destination_lng;
  else
    if new.origin_lat is distinct from old.origin_lat then new.origin_latitude:=new.origin_lat; else new.origin_lat:=new.origin_latitude; end if;
    if new.origin_lng is distinct from old.origin_lng then new.origin_longitude:=new.origin_lng; else new.origin_lng:=new.origin_longitude; end if;
    if new.destination_lat is distinct from old.destination_lat then new.destination_latitude:=new.destination_lat; else new.destination_lat:=new.destination_latitude; end if;
    if new.destination_lng is distinct from old.destination_lng then new.destination_longitude:=new.destination_lng; else new.destination_lng:=new.destination_longitude; end if;
  end if;
  return new;
end $$;
-- Runs before prepare_route, which invalidates approval if endpoint coordinates change.
create trigger a_sync_route_coordinates before insert or update on public.routes for each row execute function private.sync_route_coordinates();

create function private.prevent_duplicate_location_route() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and row(new.origin,new.destination,new.origin_lat,new.origin_lng,new.destination_lat,new.destination_lng)
    is not distinct from row(old.origin,old.destination,old.origin_lat,old.origin_lng,old.destination_lat,old.destination_lng) then return new; end if;
  if new.origin_lat is null or new.origin_lng is null or new.destination_lat is null or new.destination_lng is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(private.place_key(new.origin)||chr(31)||private.place_key(new.destination),0));
  if exists(select 1 from public.routes r where r.id<>new.id and private.place_key(r.origin)=private.place_key(new.origin)
    and private.place_key(r.destination)=private.place_key(new.destination)
    and private.endpoint_distance(r.origin_lat,r.origin_lng,new.origin_lat,new.origin_lng)<=50
    and private.endpoint_distance(r.destination_lat,r.destination_lng,new.destination_lat,new.destination_lng)<=50) then
    raise exception 'A route with these normalized locations and nearby coordinates already exists.' using errcode='23505';
  end if;
  return new;
end $$;
create trigger z_prevent_duplicate_location_route before insert or update on public.routes for each row execute function private.prevent_duplicate_location_route();

alter function public.manage_trip(uuid,jsonb) rename to manage_trip_registered;
alter function public.manage_trip_registered(uuid,jsonb) set schema private;
revoke all on function private.manage_trip_registered(uuid,jsonb) from public,anon,authenticated;
create function public.manage_trip(p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare o text; d text; olat numeric; olng numeric; dlat numeric; dlng numeric;
  route_uuid uuid; existing public.trips; matches integer; candidate public.routes;
begin
  if private.current_role() is null or private.current_role() not in ('employee','admin') then raise exception 'Staff access required.' using errcode='42501'; end if;
  if p_id is not null then select * into existing from public.trips where id=p_id for update; if not found then raise exception 'Trip not found.'; end if; end if;
  if p_data ?| array['origin_lat','origin_lng','destination_lat','destination_lng'] then
    if p_data->'locations_confirmed' is distinct from 'true'::jsonb then raise exception 'Confirm both selected locations and review the route before saving.'; end if;
    o:=regexp_replace(trim(p_data->>'origin'),'\s+',' ','g'); d:=regexp_replace(trim(p_data->>'destination'),'\s+',' ','g');
    if o is null or d is null or length(o) not between 1 and 500 or length(d) not between 1 and 500 then raise exception 'Provide a location label for both selected pins (up to 500 characters).'; end if;
    if jsonb_typeof(p_data->'origin_lat') is distinct from 'number' or jsonb_typeof(p_data->'origin_lng') is distinct from 'number'
      or jsonb_typeof(p_data->'destination_lat') is distinct from 'number' or jsonb_typeof(p_data->'destination_lng') is distinct from 'number' then
      raise exception 'Both locations require confirmed numeric latitude and longitude coordinates.';
    end if;
    olat:=(p_data->>'origin_lat')::numeric; olng:=(p_data->>'origin_lng')::numeric;
    dlat:=(p_data->>'destination_lat')::numeric; dlng:=(p_data->>'destination_lng')::numeric;
    if olat not between -90 and 90 or dlat not between -90 and 90 or olng not between -180 and 180 or dlng not between -180 and 180 then raise exception 'Selected location coordinates are invalid.'; end if;
    olat:=round(olat,6); olng:=round(olng,6); dlat:=round(dlat,6); dlng:=round(dlng,6);
    if private.endpoint_distance(olat,olng,dlat,dlng)<5 then raise exception 'Choose different origin and destination positions (at least 5 metres apart).'; end if;
    perform pg_advisory_xact_lock(hashtextextended(private.place_key(o)||chr(31)||private.place_key(d),0));
    select id into route_uuid from public.routes where private.place_key(origin)=private.place_key(o) and private.place_key(destination)=private.place_key(d)
      and private.endpoint_distance(origin_lat,origin_lng,olat,olng)<=50 and private.endpoint_distance(destination_lat,destination_lng,dlat,dlng)<=50
      order by private.endpoint_distance(origin_lat,origin_lng,olat,olng)+private.endpoint_distance(destination_lat,destination_lng,dlat,dlng),id limit 1;
    if route_uuid is null then
      insert into public.routes(origin,destination,origin_lat,origin_lng,destination_lat,destination_lng)
      values(o,d,olat,olng,dlat,dlng) returning id into route_uuid;
    end if;
    -- A suggestion is not approved geometry. Ignore client road_path/is_approved.
    p_data:=(p_data-'origin'-'destination'-'road_path'-'is_approved')||jsonb_build_object('route_id',route_uuid);
  elsif p_data ? 'origin' or p_data ? 'destination' then
    -- Older clients may still select registered names; never pick an arbitrary
    -- route when dynamically selected locations make those names ambiguous.
    select count(*) into matches from public.routes where private.place_key(origin)=private.place_key(p_data->>'origin') and private.place_key(destination)=private.place_key(p_data->>'destination');
    if matches>1 then
      select * into candidate from public.routes where id=existing.route_id;
      if p_id is null or private.place_key(candidate.origin) is distinct from private.place_key(p_data->>'origin') or private.place_key(candidate.destination) is distinct from private.place_key(p_data->>'destination') then
        raise exception 'These labels identify several routes. Select and confirm the location coordinates.';
      end if;
      p_data:=(p_data-'origin'-'destination')||jsonb_build_object('route_id',existing.route_id);
    end if;
  end if;
  return private.manage_trip_registered(p_id,p_data);
end $$;
revoke all on function private.endpoint_distance(numeric,numeric,numeric,numeric),private.sync_route_coordinates(),private.prevent_duplicate_location_route() from public,anon,authenticated;
revoke all on function public.manage_trip(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_trip(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
