-- Run as a trusted project owner in SQL Editor and download the result as CSV.
-- Never export pending request correlation or use the service-role key in the browser.
select s.trip_id,s.remaining_road_distance_m,s.routing_minutes,s.speed_kmh,s.observed_at,
       s.actual_arrival_at,s.actual_remaining_minutes
from public.eta_training_samples s
join public.trips t on t.id=s.trip_id
join public.buses b on b.id=t.bus_id
where s.sample_state='verified' and s.actual_arrival_at is not null
  and s.actual_remaining_minutes>0 and s.request_id is null and t.status='completed'
  and b.plate_number !~* '^(DEMO|TEST)([[:space:]_-]|$)'
order by s.observed_at,s.id;
