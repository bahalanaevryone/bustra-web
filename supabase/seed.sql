-- OPTIONAL DEMO DATA ONLY. Not official routes, stops, schedules, or operator affiliations.
-- Apply after the core migration and admin bootstrap. Creates no auth users or GPS data.
begin;
insert into public.buses(id,plate_number,capacity) values
 ('d0000000-0000-4000-8000-000000000001','DEMO 001',40),
 ('d0000000-0000-4000-8000-000000000002','DEMO 002',36)
on conflict(id) do nothing;
insert into public.routes(id,route_name,origin,destination) values
 ('d0000000-0000-4000-8000-000000000011','DEMO · Mamburao local loop','DEMO illustrative terminal','DEMO illustrative north stop'),
 ('d0000000-0000-4000-8000-000000000012','DEMO · Coastal connector','DEMO illustrative centre','DEMO illustrative coastal stop')
on conflict(id) do nothing;
insert into public.pickup_points(id,route_id,name,latitude,longitude,stop_order) values
 ('d0000000-0000-4000-8000-000000000021','d0000000-0000-4000-8000-000000000011','DEMO · Central pickup',13.2233,120.5960,1),
 ('d0000000-0000-4000-8000-000000000022','d0000000-0000-4000-8000-000000000011','DEMO · North pickup',13.2370,120.6010,2),
 ('d0000000-0000-4000-8000-000000000023','d0000000-0000-4000-8000-000000000012','DEMO · Coastal pickup',13.2150,120.5880,1)
on conflict(id) do nothing;
insert into public.trips(id,bus_id,route_id,created_by,departure_at,status)
select 'd0000000-0000-4000-8000-000000000031','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000011',id,now()+interval '1 hour','scheduled'
from public.profiles where role='admin'
on conflict(id) do nothing;
commit;
