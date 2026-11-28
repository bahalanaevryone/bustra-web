-- Run as a trusted project owner in SQL Editor and download the result as CSV.
-- Never export pending request correlation or use the service-role key in the browser.
select trip_id,remaining_road_distance_m,routing_minutes,speed_kmh,observed_at,
       actual_arrival_at,actual_remaining_minutes
from public.eta_training_samples
where actual_arrival_at is not null and actual_remaining_minutes>0 and request_id is null
order by observed_at,id;
