-- Additive: keep all six core tables and one minimal training table.
begin;
alter table public.bus_location add column course_degrees numeric check(course_degrees>=0 and course_degrees<360);

create table public.eta_training_samples (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  -- Temporary correlation for GPS verification; erased on completion. No passenger ID or coordinates.
  request_id uuid references public.pickup_requests(id) on delete set null,
  remaining_road_distance_m numeric not null check(remaining_road_distance_m between 0 and 2000000),
  routing_minutes numeric not null check(routing_minutes between 0 and 720),
  speed_kmh numeric check(speed_kmh between 0 and 200),
  observed_at timestamptz not null,
  hour_of_day numeric not null check(hour_of_day>=0 and hour_of_day<24),
  day_of_week integer not null check(day_of_week between 0 and 6),
  actual_arrival_at timestamptz,
  actual_remaining_minutes numeric,
  -- First of two consecutive nearby fixes; never an accepted-request timestamp.
  arrival_candidate_at timestamptz,
  unique(request_id,observed_at),
  check ((actual_arrival_at is null and actual_remaining_minutes is null) or
    (actual_arrival_at is not null and actual_remaining_minutes is not null
     and actual_arrival_at>observed_at and actual_remaining_minutes>0 and actual_remaining_minutes<=720
     and abs(actual_remaining_minutes-extract(epoch from (actual_arrival_at-observed_at))/60)<0.00001))
);
create index eta_samples_trip_pending on public.eta_training_samples(trip_id,observed_at) where actual_arrival_at is null;
alter table public.eta_training_samples enable row level security;
revoke all on public.eta_training_samples from public,anon,authenticated;
grant select on public.eta_training_samples to authenticated;
create policy eta_samples_admin_read on public.eta_training_samples for select to authenticated
  using ((select private.current_role())='admin');
grant all on public.eta_training_samples to service_role;
create policy eta_samples_service on public.eta_training_samples for all to service_role using(true) with check(true);

create function private.eta_metres(a numeric,b numeric,c numeric,d numeric) returns double precision
language sql immutable strict set search_path='' as $$
  select 12742000*asin(sqrt(least(1.0,power(sin(radians((c-a)::double precision)/2),2)+cos(radians(a::double precision))*cos(radians(c::double precision))*power(sin(radians((d-b)::double precision)/2),2))));
$$;

-- Only derive a course from recent, accurate, sufficiently separated fixes.
create function private.eta_course() returns trigger language plpgsql set search_path='' as $$
declare separation double precision; seconds double precision;
begin
  new.course_degrees:=null;
  if tg_op='UPDATE' and old.accuracy_m<=100 and new.accuracy_m<=100 then
    seconds:=extract(epoch from(new.updated_at-old.updated_at));
    separation:=private.eta_metres(old.latitude,old.longitude,new.latitude,new.longitude);
    if seconds between 2 and 90 and separation>greatest(20,old.accuracy_m+new.accuracy_m)
       and separation/seconds<=55.56 then
      new.course_degrees:=mod((degrees(atan2(
        sin(radians((new.longitude-old.longitude)::double precision))*cos(radians(new.latitude::double precision)),
        cos(radians(old.latitude::double precision))*sin(radians(new.latitude::double precision))-
        sin(radians(old.latitude::double precision))*cos(radians(new.latitude::double precision))*cos(radians((new.longitude-old.longitude)::double precision))
      ))+360)::numeric,360);
    end if;
  end if;
  return new;
end;
$$;
create trigger eta_course before insert or update on public.bus_location for each row execute function private.eta_course();

-- Trigger is internal and runs under the trusted location writer. GPS keeps working without an ETA viewer.
create function private.eta_verify_arrivals() returns trigger language plpgsql security definer set search_path='' as $$
declare item record; near_pin boolean; previous_near boolean;
begin
  if not exists(select 1 from public.trips where id=new.trip_id and status='active') then return new; end if;
  -- Discard old/unreliable labels rather than guess through gaps or after cancellations.
  delete from public.eta_training_samples s where s.trip_id=new.trip_id and s.actual_arrival_at is null
    and (s.observed_at<new.updated_at-interval '12 hours' or not exists(
      select 1 from public.pickup_requests q where q.id=s.request_id and q.status in ('pending','accepted')));
  for item in select s.id,s.observed_at,s.arrival_candidate_at,q.pickup_latitude,q.pickup_longitude
    from public.eta_training_samples s join public.pickup_requests q on q.id=s.request_id
    where s.trip_id=new.trip_id and s.actual_arrival_at is null and q.status in ('pending','accepted')
  loop
    -- Require continuous high quality GPS since observation (2..90 seconds between reports).
    if tg_op<>'UPDATE' or old.accuracy_m is null or new.accuracy_m is null or old.accuracy_m>25 or new.accuracy_m>25
       or new.updated_at-old.updated_at not between interval '2 seconds' and interval '90 seconds'
       or new.updated_at>now()+interval '10 seconds' or new.updated_at<now()-interval '90 seconds'
       or private.eta_metres(old.latitude,old.longitude,new.latitude,new.longitude)/greatest(1,extract(epoch from(new.updated_at-old.updated_at)))>55.56 then
      delete from public.eta_training_samples where id=item.id;
      continue;
    end if;
    near_pin:=private.eta_metres(new.latitude,new.longitude,item.pickup_latitude,item.pickup_longitude)<=50;
    previous_near:=private.eta_metres(old.latitude,old.longitude,item.pickup_latitude,item.pickup_longitude)<=50;
    if near_pin and previous_near and item.arrival_candidate_at is not null
       and old.updated_at>=item.arrival_candidate_at and new.updated_at>=item.arrival_candidate_at+interval '5 seconds'
       and item.arrival_candidate_at>item.observed_at then
      update public.eta_training_samples set actual_arrival_at=item.arrival_candidate_at,
        actual_remaining_minutes=extract(epoch from(item.arrival_candidate_at-observed_at))/60,
        request_id=null,arrival_candidate_at=null where id=item.id;
    else
      update public.eta_training_samples set arrival_candidate_at=case when near_pin then coalesce(case when previous_near then arrival_candidate_at end,new.updated_at) else null end where id=item.id;
    end if;
  end loop;
  return new;
end;
$$;
create trigger eta_verify_arrivals after insert or update on public.bus_location for each row execute function private.eta_verify_arrivals();

create function private.eta_discard_ended() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('completed','cancelled') then
    delete from public.eta_training_samples where trip_id=new.id and actual_arrival_at is null;
  end if;
  return new;
end;
$$;
create trigger eta_discard_ended after update of status on public.trips for each row execute function private.eta_discard_ended();

-- Explicit public projection: never expose driver IDs or private trip rows.
create function public.eta_context(p_trip uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('trip_id',t.id,'route',jsonb_build_object(
    'id',r.id,'road_path',r.road_path,'origin_lat',r.origin_lat,'origin_lng',r.origin_lng,
    'destination_lat',r.destination_lat,'destination_lng',r.destination_lng),
    'location',(select to_jsonb(l) from public.bus_location l where l.trip_id=t.id))
  from public.trips t join public.routes r on r.id=t.route_id where t.id=p_trip and t.status='active';
$$;

-- Service-only writer. Routing features may never be supplied by an untrusted browser.
create function public.record_eta_sample(p_request uuid,p_observed timestamptz,p_distance numeric,p_minutes numeric) returns void
language plpgsql security definer set search_path='' as $$
declare q public.pickup_requests; l public.bus_location; local_time timestamp;
begin
  select * into q from public.pickup_requests where id=p_request and status in ('pending','accepted') for share;
  if not found then return; end if;
  -- Lock against GPS updates so an arrival cannot race with a late sample insert.
  select * into l from public.bus_location where trip_id=q.trip_id for share;
  if not found or l.updated_at is distinct from p_observed or l.updated_at<now()-interval '90 seconds'
     or l.updated_at>now()+interval '10 seconds' or l.accuracy_m is null or l.accuracy_m>25
     or q.requested_at>l.updated_at or not exists(select 1 from public.trips where id=q.trip_id and status='active')
     or private.eta_metres(l.latitude,l.longitude,q.pickup_latitude,q.pickup_longitude)<=100 then return; end if;
  if p_distance is null or p_distance<=0 or p_distance>2000000 or p_minutes is null or p_minutes<=0 or p_minutes>720 then return; end if;
  if exists(select 1 from public.eta_training_samples where request_id=q.id and observed_at>=p_observed-interval '60 seconds') then return; end if;
  local_time:=p_observed at time zone 'Asia/Manila';
  insert into public.eta_training_samples(trip_id,request_id,remaining_road_distance_m,routing_minutes,speed_kmh,observed_at,hour_of_day,day_of_week)
    values(q.trip_id,q.id,p_distance,p_minutes,l.speed_kmh,p_observed,
      extract(hour from local_time)+extract(minute from local_time)/60,extract(isodow from local_time)::integer-1)
    on conflict(request_id,observed_at) do nothing;
end;
$$;
revoke all on function private.eta_metres(numeric,numeric,numeric,numeric),private.eta_course(),private.eta_verify_arrivals(),private.eta_discard_ended() from public,anon,authenticated;
-- Trigger calls the helper under publish_location's definer, never directly from the browser.
revoke all on function public.eta_context(uuid),public.record_eta_sample(uuid,timestamptz,numeric,numeric) from public,anon,authenticated;
grant execute on function public.eta_context(uuid) to authenticated,service_role;
grant execute on function public.record_eta_sample(uuid,timestamptz,numeric,numeric) to service_role;
notify pgrst,'reload schema';
commit;
