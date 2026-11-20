# Passenger-selected pickup locations

Passengers choose a one-time pickup pin for an active bus. No administrator-created pickup catalog is required. This update supersedes earlier documentation that limited requests to registered stops.

## Components and flow

- `src/features/buses/BusDetails.tsx`: active bus details, passenger access, guest login with a return intent, and the Request Pickup button.
- `src/features/pickups/PickupSelector.tsx`: one-time GPS, optional address lookup/custom label, manual pin placement, server proximity assessment and explicit confirmation. Permission denial or a GPS timeout leaves manual selection available. GPS does not continuously track the passenger.
- `src/features/pickups/PickupMap.tsx`: tap/click placement, dragging and arrow-key adjustment. Only stored road geometry is drawn here; endpoint straight lines are never used to verify a pickup.
- `src/pages/Dashboard.tsx` and `src/features/map/BusMap.tsx`: private orange pending pins and teal accepted pins at the requested coordinates; assigned-driver queue, coordinates, labels, safe-response acknowledgement and optional response/rejection note.
- `src/pages/Account.tsx`: owner-only request status, response note, coordinates and cancellation for pending/accepted requests on active trips.
- `src/hooks/useMapRequests.ts` and `src/hooks/useOperations.ts`: coordinate-based reads and Realtime subscriptions with a visible-page polling fallback. Account changes hide previously loaded private rows.
- Admin route review and schedule components no longer require or manage registered pickup stops. Existing route endpoints, trip assignment and authentication remain in place.

## Database migration

Apply `supabase/migrations/20261120104656_dynamic_passenger_pickups.sql` once, after the preceding migrations. For a fresh install, apply all migration files in filename order. Do not rerun the initial schema on an existing database.

The transaction backfills every historical request from its referenced stop and aborts if any coordinates cannot be recovered. It retains request IDs/timestamps and archives former operator stops in `routes.legacy_pickup_points`, which is excluded from browser table grants and the public feed. Duplicate historical open requests are retained as expired history; an accepted request takes precedence over another pending request. The foreign-key column and old catalog are removed only after replacing dependent functions and checking dependencies. `DROP TABLE ... RESTRICT` refuses unexpected relational dependencies. No `CASCADE` is used.

The six main public tables are `profiles`, `buses`, `routes`, `trips`, `bus_location`, and `pickup_requests`. Trips retain their route foreign keys. Pickup requests store:

| Field | Purpose |
| --- | --- |
| `id`, `user_id`, `trip_id` | Existing identifiers and ownership/assignment |
| `pickup_latitude`, `pickup_longitude` | Required `numeric(9,6)` coordinates with latitude/longitude range constraints |
| `pickup_address` | Optional selected address or passenger label, up to 500 characters |
| `status`, `requested_at`, `responded_at` | Request lifecycle and timestamps |
| `route_verification`, `route_distance_m` | Assessment based on stored actual road geometry, or explicitly unverified |
| `response_note` | Optional driver response or rejection reason, up to 300 characters |

RPCs are `check_pickup_location(trip, latitude, longitude)`, `request_pickup(trip, latitude, longitude, address)`, `respond_pickup(request, status, safe_to_respond, reason)` and the existing `cancel_pickup(request)`.

The server computes minimum distance to segments in `routes.road_path` using a local projection suitable for the service area. More than 500 metres from stored geometry is rejected; a nearby point is labelled near an operator-reviewed or suggested path as appropriate. Missing geometry permits an explicitly **unverified** request for driver review. Proximity is a screening threshold, never permission to stop. Newly fetched browser routing suggestions are not passed off as stored/verified geometry. The server rechecks route distance, active trip, assignment and bus capacity at submission/acceptance; rejection remains available for unsafe locations. Acceptance neither increments passenger count nor reserves a seat.

RLS permits request reads only by the owner or an employee assigned to that trip. A generic administrator role has no passenger-coordinate access. Guests receive no request data. Direct browser inserts/updates are prohibited; guarded RPCs derive ownership from Auth. There is one open request per passenger/trip and a five-pending-request limit per passenger. The Realtime publication retains `pickup_requests`; subscriptions respect these row permissions.

## Configuration

Use the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put a service-role key in the browser. Keep the `private` schema unexposed.

`VITE_GEOCODING_URL` points to the existing Photon-compatible provider; reverse lookup is optional and may send the chosen position to that provider. An empty/unavailable result leaves the coordinates and optional custom label usable. No new API key is required for the existing test configuration. Deploy an appropriately provisioned service for larger usage. Public Nominatim autocomplete is not used.

`VITE_MAP_TILE_URL`/`VITE_MAP_ATTRIBUTION` retain the current map provider configuration. `VITE_ROUTING_URL` remains the existing OSRM-compatible service for route previews. Pickup coordinates are never sent to the road router. Hosted GPS needs HTTPS; localhost is permitted for development. Android precise-location permissions improve device estimates; a pin remains adjustable when GPS is inaccurate.

## Test the process

1. Use an assigned employee account on the laptop to create/start a trip with free capacity. Use a separate passenger account on Android at the HTTPS site. A missing bus GPS fix does not prevent selecting an active bus from the list.
2. Open **Live map**, select the bus, and tap **Request Pickup**.
3. Try **Use My Current Location**, verify the pin and drag it if necessary. Also test denying GPS, then **Choose Location on Map**. Tap the map and optionally enter a landmark.
4. Review the coordinates, bus and proximity message. Without stored road geometry, expect the unverified warning. A point beyond 500 metres from stored geometry must be blocked. Suggested paths must not be labelled operator-approved.
5. Check the confirmation box and submit. In **My requests**, expect Pending. Repeat submission must be rejected while an open request exists.
6. On the assigned employee dashboard, check the coordinates/address and orange pickup pin. Use **Show pickup on map**. Confirm that you are safely stopped or the authorized assigned crew member, then accept or reject with an optional reason.
7. Check the passenger receives the new status through Realtime or the 15-second polling fallback. Accepted pins become teal; the onboard count stays unchanged. Cancel your own pending or accepted request and verify cancellation.
8. Test a different passenger, unrelated employee and generic admin: none should read the passenger's coordinates or answer the request. Guests can browse buses but must log in before requesting.
9. Fill the bus and verify new requests and acceptance are rejected. Drivers may still reject. End a trip and verify pending requests expire and no new request can be submitted.

Automated checks: `npm.cmd run check` and `npm.cmd run test:e2e`. Database tests exercise historical migrations before this upgrade, then verify safe backfill, six tables, actual RLS/grants and the new RPCs. Browser tests cover manual/GPS pin selection, denial, confirmation, distance/error states, driver responses and status polling on desktop/mobile. Real Android accuracy and two-device hosted Realtime delivery require the manual device checks above; mocked browser tests do not establish those properties.
