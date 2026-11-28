-- Explain collection outcomes without adding a passenger history or another table.
begin;
alter table public.eta_training_samples
  add column sample_state text not null default 'pending',
  add column rejection_reason text,
  add column attempted_at timestamptz not null default now(),
  alter column remaining_road_distance_m drop not null,
  alter column routing_minutes drop not null;
update public.eta_training_samples set sample_state='verified',attempted_at=observed_at where actual_arrival_at is not null;
update public.eta_training_samples set attempted_at=observed_at where sample_state='pending';
alter table public.eta_training_samples add constraint eta_sample_lifecycle check(
  (sample_state='pending' and actual_arrival_at is null and rejection_reason is null and remaining_road_distance_m>0 and remaining_road_distance_m is not null and routing_minutes>0 and routing_minutes is not null)
  or (sample_state='verified' and actual_arrival_at is not null and rejection_reason is null and remaining_road_distance_m>0 and remaining_road_distance_m is not null and routing_minutes>0 and routing_minutes is not null)
  or (sample_state='rejected' and actual_arrival_at is null and rejection_reason is not null)
);
create index eta_samples_request_attempt on public.eta_training_samples(request_id,attempted_at desc);
create index eta_samples_state on public.eta_training_samples(sample_state,attempted_at);
alter table public.bus_location add column eta_collection_status jsonb;
comment on column public.bus_location.eta_collection_status is 'Service-written last collection check: only status codes, timestamp and counts; no pickup positions or identities.';

-- Collection metadata updates must never reset course or look like a new GPS observation.
drop trigger eta_course on public.bus_location;
create trigger eta_course before insert or update of latitude,longitude,updated_at,accuracy_m,speed_kmh on public.bus_location for each row execute function private.eta_course();
drop trigger eta_verify_arrivals on public.bus_location;

create or replace function private.eta_verify_arrivals() returns trigger language plpgsql security definer set search_path='' as $$
declare item record; reason text; near_pin boolean; previous_near boolean;
begin
  if not exists(select 1 from public.trips where id=new.trip_id and status='active') then return new; end if;
  for item in select s.id,s.observed_at,s.arrival_candidate_at,q.status,q.pickup_latitude,q.pickup_longitude
    from public.eta_training_samples s left join public.pickup_requests q on q.id=s.request_id
    where s.trip_id=new.trip_id and s.sample_state='pending'
  loop
    reason:=null;
    if item.status is null or item.status not in ('pending','accepted') then reason:='request_closed';
    elsif item.observed_at<new.updated_at-interval '12 hours' then reason:='observation_expired';
    elsif tg_op<>'UPDATE' or new.updated_at-old.updated_at not between interval '2 seconds' and interval '90 seconds' then reason:='gps_gap';
    elsif old.accuracy_m is null or new.accuracy_m is null or old.accuracy_m>100 or new.accuracy_m>100
      or new.updated_at>now()+interval '10 seconds' or new.updated_at<now()-interval '90 seconds' then reason:='unreliable_gps';
    elsif private.eta_metres(old.latitude,old.longitude,new.latitude,new.longitude)/greatest(1,extract(epoch from(new.updated_at-old.updated_at)))>55.56 then reason:='gps_jump';
    end if;
    if reason is not null then
      update public.eta_training_samples set sample_state='rejected',rejection_reason=reason,arrival_candidate_at=null where id=item.id;
      continue;
    end if;
    -- Intermediate 25..100 m fixes are ignored for arrival instead of destroying a valid earlier sample.
    if new.accuracy_m>25 or old.accuracy_m>25 then
      update public.eta_training_samples set arrival_candidate_at=null where id=item.id;
      continue;
    end if;
    near_pin:=private.eta_metres(new.latitude,new.longitude,item.pickup_latitude,item.pickup_longitude)<=50;
    previous_near:=private.eta_metres(old.latitude,old.longitude,item.pickup_latitude,item.pickup_longitude)<=50;
    if near_pin and previous_near and item.arrival_candidate_at is not null
      and old.updated_at>=item.arrival_candidate_at and new.updated_at>=item.arrival_candidate_at+interval '5 seconds'
      and item.arrival_candidate_at>item.observed_at then
      update public.eta_training_samples set sample_state='verified',actual_arrival_at=item.arrival_candidate_at,
        actual_remaining_minutes=extract(epoch from(item.arrival_candidate_at-observed_at))/60,
        request_id=null,arrival_candidate_at=null where id=item.id;
    else
      update public.eta_training_samples set arrival_candidate_at=case when near_pin then coalesce(case when previous_near then arrival_candidate_at end,new.updated_at) else null end where id=item.id;
    end if;
  end loop;
  return new;
end;
$$;
create trigger eta_verify_arrivals after insert or update of latitude,longitude,updated_at,accuracy_m,speed_kmh on public.bus_location for each row execute function private.eta_verify_arrivals();

create or replace function private.eta_discard_ended() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('completed','cancelled') then
    update public.eta_training_samples set sample_state='rejected',rejection_reason='trip_ended',arrival_candidate_at=null where trip_id=new.id and sample_state='pending';
  end if;
  return new;
end;
$$;
create function private.eta_request_closed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status not in ('pending','accepted') then
    update public.eta_training_samples set sample_state='rejected',rejection_reason='request_closed',arrival_candidate_at=null where request_id=new.id and sample_state='pending';
  end if;
  return new;
end;
$$;
create trigger eta_request_closed after update of status on public.pickup_requests for each row execute function private.eta_request_closed();

-- Explicit result: a skipped or throttled write is never reported as a recorded observation.
drop function public.record_eta_sample(uuid,timestamptz,numeric,numeric);
create function public.record_eta_sample(p_request uuid,p_observed timestamptz,p_distance numeric,p_minutes numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.pickup_requests; l public.bus_location; local_time timestamp; saved uuid; reason text;
begin
  select * into q from public.pickup_requests where id=p_request and status in ('pending','accepted') for update;
  if not found then return jsonb_build_object('status','skipped','reason','request_closed'); end if;
  select * into l from public.bus_location where trip_id=q.trip_id for share;
  if not found then reason:='gps_missing';
  elsif l.updated_at is distinct from p_observed then reason:='location_changed';
  elsif l.updated_at<now()-interval '90 seconds' or l.updated_at>now()+interval '10 seconds' then reason:='gps_stale';
  elsif l.accuracy_m is null or l.accuracy_m>25 then reason:='gps_inaccurate';
  elsif q.requested_at>l.updated_at then reason:='request_newer_than_gps';
  elsif not exists(select 1 from public.trips where id=q.trip_id and status='active') then reason:='trip_ended';
  elsif exists(select 1 from public.trips t join public.buses b on b.id=t.bus_id where t.id=q.trip_id and b.plate_number~*'^(DEMO|TEST)([[:space:]_-]|$)') then reason:='demo_trip';
  elsif private.eta_metres(l.latitude,l.longitude,q.pickup_latitude,q.pickup_longitude)<=100 then reason:='too_close';
  elsif p_distance is null or p_distance<=0 or p_distance>2000000 or p_minutes is null or p_minutes<=0 or p_minutes>720 then reason:='features_invalid';
  end if;
  if reason is not null then return jsonb_build_object('status','skipped','reason',reason); end if;
  if exists(select 1 from public.eta_training_samples where request_id=q.id and sample_state in ('pending','verified') and observed_at>=p_observed-interval '60 seconds') then
    return jsonb_build_object('status','throttled','reason','sample_interval');
  end if;
  local_time:=p_observed at time zone 'Asia/Manila';
  insert into public.eta_training_samples(trip_id,request_id,remaining_road_distance_m,routing_minutes,speed_kmh,observed_at,hour_of_day,day_of_week)
  values(q.trip_id,q.id,p_distance,p_minutes,l.speed_kmh,p_observed,extract(hour from local_time)+extract(minute from local_time)/60,extract(isodow from local_time)::integer-1)
  on conflict(request_id,observed_at) do nothing returning id into saved;
  return jsonb_build_object('status',case when saved is null then 'throttled' else 'recorded' end);
end;
$$;

create function public.record_eta_rejection(p_request uuid,p_observed timestamptz,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.pickup_requests; stamp timestamptz; saved uuid; local_time timestamp;
begin
  if p_reason not in ('gps_missing','gps_stale','gps_inaccurate','direction_unknown','moving_away','passed','bus_off_route','pickup_off_route','ambiguous_route','route_mismatch','route_unavailable','no_route','routing_unavailable','route_endpoints_mismatch','demo_trip','near_pickup','features_invalid','location_changed','request_newer_than_gps','too_close','unknown_failure','trip_ended','request_closed') then raise exception 'Unsupported ETA diagnostic reason.'; end if;
  select * into q from public.pickup_requests where id=p_request and status in ('pending','accepted') for update;
  if not found then return jsonb_build_object('status','skipped','reason','request_closed'); end if;
  if exists(select 1 from public.eta_training_samples where request_id=q.id and attempted_at>now()-interval '60 seconds' and sample_state='rejected' and rejection_reason=p_reason) then return jsonb_build_object('status','throttled'); end if;
  stamp:=coalesce(p_observed,now());local_time:=stamp at time zone 'Asia/Manila';
  insert into public.eta_training_samples(trip_id,request_id,observed_at,hour_of_day,day_of_week,sample_state,rejection_reason)
    values(q.trip_id,q.id,stamp,extract(hour from local_time)+extract(minute from local_time)/60,extract(isodow from local_time)::integer-1,'rejected',p_reason)
    on conflict(request_id,observed_at) do update set attempted_at=now(),rejection_reason=excluded.rejection_reason
      where eta_training_samples.sample_state='rejected' returning id into saved;
  return jsonb_build_object('status',case when saved is null then 'throttled' else 'rejected' end,'reason',p_reason);
end;
$$;

create function public.eta_note_collection(p_trip uuid,p_status text,p_attempted integer,p_recorded integer,p_rejected integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('ok','no_open_requests','gps_missing','gps_stale','gps_inaccurate','routing_unavailable','route_unavailable','route_endpoints_mismatch','failed') or p_attempted not between 0 and 8 or p_recorded not between 0 and p_attempted or p_rejected not between 0 and p_attempted then raise exception 'Invalid collection summary.'; end if;
  update public.bus_location set eta_collection_status=jsonb_build_object('checked_at',now(),'status',p_status,'attempted',p_attempted,'recorded',p_recorded,'rejected',p_rejected) where trip_id=p_trip;
end;
$$;

create function private.eta_require_staff_trip(p_trip uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or (private.active_admin(auth.uid()) or (private.current_role()='employee' and private.owns_trip(p_trip))) is not true then raise exception 'Assigned employee or active administrator access required.' using errcode='42501'; end if;
end;
$$;
create function public.eta_diagnostic_context(p_trip uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.eta_require_staff_trip(p_trip);
  return (select jsonb_build_object('trip_id',t.id,'trip_status',t.status,'bus',b.plate_number,'route',jsonb_build_object('id',r.id,'is_approved',r.is_approved,'road_path',r.road_path,'origin_lat',r.origin_lat,'origin_lng',r.origin_lng,'destination_lat',r.destination_lat,'destination_lng',r.destination_lng),'location',(select to_jsonb(l) from public.bus_location l where l.trip_id=t.id)) from public.trips t join public.routes r on r.id=t.route_id join public.buses b on b.id=t.bus_id where t.id=p_trip);
end;
$$;
create function public.eta_collection_targets(p_trip uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or private.current_role() is distinct from 'employee' or not private.owns_trip(p_trip) then raise exception 'Assigned employee access required.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)-'last_attempt') from (
    select q.id,q.pickup_latitude,q.pickup_longitude,(select max(s.attempted_at) from public.eta_training_samples s where s.request_id=q.id) as last_attempt
    from public.pickup_requests q where q.trip_id=p_trip and q.status in ('pending','accepted')
    order by last_attempt asc nulls first,q.requested_at limit 8
  )x),'[]'::jsonb);
end;
$$;
create function public.eta_ai_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.active_admin(auth.uid()) then raise exception 'Active administrator access required.' using errcode='42501'; end if;
  return jsonb_build_object(
    'total_observations',(select count(*) from public.eta_training_samples where remaining_road_distance_m is not null and routing_minutes is not null),
    'verified_arrivals',(select count(*) from public.eta_training_samples where sample_state='verified'),
    'completed_trips',(select count(distinct s.trip_id) from public.eta_training_samples s join public.trips t on t.id=s.trip_id where s.sample_state='verified' and t.status='completed'),
    'incomplete_observations',(select count(*) from public.eta_training_samples where sample_state='pending'),
    'rejected_checks',(select count(*) from public.eta_training_samples where sample_state='rejected'),
    'rejection_reasons',coalesce((select jsonb_object_agg(rejection_reason,n) from (select rejection_reason,count(*)n from public.eta_training_samples where sample_state='rejected' group by rejection_reason)x),'{}'::jsonb),
    'active_trips',coalesce((select jsonb_agg(jsonb_build_object('trip_id',t.id,'bus',b.plate_number,'demo_data',b.plate_number~*'^(DEMO|TEST)([[:space:]_-]|$)','has_gps',l.trip_id is not null,'gps_updated_at',l.updated_at,'gps_accuracy_m',l.accuracy_m,'open_requests',(select count(*) from public.pickup_requests q where q.trip_id=t.id and q.status in ('pending','accepted')),'collection',l.eta_collection_status)) from public.trips t join public.buses b on b.id=t.bus_id left join public.bus_location l on l.trip_id=t.id where t.status='active'),'[]'::jsonb));
end;
$$;
revoke all on function private.eta_request_closed(),private.eta_require_staff_trip(uuid) from public,anon,authenticated;
revoke all on function public.record_eta_sample(uuid,timestamptz,numeric,numeric),public.record_eta_rejection(uuid,timestamptz,text),public.eta_note_collection(uuid,text,integer,integer,integer),public.eta_diagnostic_context(uuid),public.eta_collection_targets(uuid),public.eta_ai_status() from public,anon,authenticated;
grant execute on function public.record_eta_sample(uuid,timestamptz,numeric,numeric),public.record_eta_rejection(uuid,timestamptz,text),public.eta_note_collection(uuid,text,integer,integer,integer) to service_role;
grant execute on function public.eta_diagnostic_context(uuid),public.eta_collection_targets(uuid),public.eta_ai_status() to authenticated;
notify pgrst,'reload schema';
commit;
