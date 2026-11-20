# Dynamic schedule locations

Employees can search addresses or choose any valid position on the map. Neither endpoint needs to exist in Supabase. Bus and driver selections still use the operational records. All other dashboard modules and pickup permissions remain in place.

## Components

- [`ScheduleEditor.tsx`](../src/features/schedules/ScheduleEditor.tsx): responsive schedule form, generated name, route preview, assignment/count validation and explicit confirmation.
- [`LocationSearch.tsx`](../src/features/schedules/LocationSearch.tsx): keyboard-accessible address suggestions, loading/empty/error states, coordinate readout and editable location label.
- [`ScheduleMap.tsx`](../src/features/schedules/ScheduleMap.tsx): Origin A and Destination B pins, click/tap selection, dragging and arrow-key repositioning, reviewed/suggested paths and designated stops for a matching route.
- [`geocoding.ts`](../src/features/schedules/geocoding.ts): Photon search/reverse adapter, cancellation, five-minute bounded cache, shared request queue and rate-limit handling.
- [`scheduleRoutes.ts`](../src/features/schedules/scheduleRoutes.ts): endpoint validation, automatic names and coordinate-aware matching. The old registered-location picker has been removed.
- `EntityEditor` delegates schedule work to `ScheduleEditor`; the existing admin record forms retain their responsibilities. The shared modal gains an optional CSS class for the wider form.

## Configuration and provider terms

Set these public browser configuration values in `.env.local` for local use and in GitHub **Settings → Secrets and variables → Actions → Variables** for hosted builds. Restart Vite or rebuild after a change. The current hosted test site is configured separately during deployment.

```dotenv
VITE_GEOCODING_URL=https://photon.komoot.io
VITE_ROUTING_URL=https://router.project-osrm.org
VITE_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
VITE_MAP_ATTRIBUTION=&copy; OpenStreetMap contributors
```

The Photon and OSRM demo endpoints require no API key for light testing. Use your own Photon-compatible service and appropriate routing/tile providers for wider deployment. A self-hosted Photon instance must allow browser CORS from your app's origin. A blank geocoding URL disables address lookup while map selection and custom labels continue working. A blank routing URL disables routing; confirmed locations can still be scheduled pending operator review.

[Photon supports interactive search and reverse geocoding](https://github.com/komoot/photon), and permits reasonable use of its public demo while reserving throttling/blocking and offering no availability guarantee. Search is debounced for 800 ms with a three-character minimum, at most five suggestions, cancellation of obsolete requests, bounded caching and a shared queue spaced at least 1.1 seconds apart per tab. Reverse lookup runs after pin placement/dragging, not for every drag frame or GPS update. A 429 response pauses new requests for a minute. Search is biased toward the configured map viewport but is not restricted to database locations or a fixed area. Only nearby reverse results are used; they never move the user's pin.

The public OpenStreetMap Nominatim service is not used for autocomplete, and the adapter rejects that endpoint. Search and maps display OpenStreetMap attribution. Photon source is Apache-2.0; its OSM-derived data requires applicable attribution/ODbL compliance. See the [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [OSRM demo terms](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). Automated browser tests intercept map tiles instead of repeatedly loading the community tile service.

## Database migration

Apply [`20261120055359_dynamic_schedule_locations.sql`](../supabase/migrations/20261120055359_dynamic_schedule_locations.sql) after the two existing migrations. It adds `origin_lat`, `origin_lng`, `destination_lat` and `destination_lng`, and copies the previous coordinate values without deleting routes, trips or pickup points. The older coordinate columns remain synchronized for compatible rollout; `routes`, `trips.route_id` and all seven application tables remain intact. Address labels can contain up to 500 characters; route names are generated from the labels.

Dynamic schedule requests send both labels, numeric coordinates and `locations_confirmed: true`. The database validates coordinate ranges, nonempty labels and at least five metres between positions. Endpoint matching requires normalized origin/destination labels **and both endpoints within 50 metres** of an existing directional route. A transaction advisory lock on the normalized label pair serializes matching/creation; a database trigger also rejects near duplicates. The same labels at distant coordinates produce a different route. Reverse journeys remain distinct. Missing coordinates are never replaced with map-centre defaults. Legacy unlocated routes remain available, but are not reused as coordinate-confirmed routes merely because their labels match.

Route resolution, new-route creation and trip insertion occur in one transaction. Capacity/assignment failures roll back new routes. Existing operator approval is preserved when a reviewed route is reused; moving an endpoint invalidates its review. Former RPC implementations remain private and unavailable to browser roles.

## Review and pickup behavior

After selecting both endpoints, the form shows the generated name and either an existing reviewed path or an available driving suggestion from the configured router. It draws no road line when routing fails or is not configured. Search results are actual provider data; an unmatched pin needs an employee-supplied label and retains its coordinates.

The employee must check **I verified both location pins and reviewed the route information above** before saving. Changing either location, label or assignment clears this confirmation. A suggested road path is never saved as approved geometry, and a new route never creates pickup points automatically. Existing approved route geometry and designated stops remain separate from a suggestion. Routing cannot establish that a road is approved for bus use.

Operator approval continues through the existing authorized admin route-review workflow. Passengers can only request active designated stops belonging to their selected trip's approved route and within its reviewed corridor. Staff acceptance revalidates the route and stop. No arbitrary point along a suggested road becomes a pickup location.

## Testing

```powershell
npm.cmd run check
npm.cmd run test:e2e
```

`check` covers TypeScript, unit tests, all migrations in PGlite and a production build. The database suite covers unregistered/custom endpoints, coordinate-aware reuse, equal labels at distant positions, confirmation/range validation, zero-degree coordinates, long labels, capacity rollback, approval retention/invalidation and private RPC grants. Browser tests use intercepted auth/backend/geocoding/routing responses and run desktop and mobile layouts.

Manual verification:

1. Sign in as an employee and open **Schedules → Add schedule**. Search a new city, barangay, landmark or street; choose a suggestion and verify its pin.
2. Select **Choose on Map** for the other endpoint, tap a position and drag the pin. If reverse lookup has no address, supply a custom location label.
3. Check the generated name and road preview. Review actual bus access and designated pickup points with the operator; a driving suggestion does not establish approval.
4. Choose bus/driver/time/count, confirm the locations and save. Repeating the same normalized labels and nearby positions should reuse `route_id`; distant equal labels should not.
5. Move a pin after confirming: confirmation must clear. Type an address without selecting a result: saving must stay disabled until a position is selected.
6. Disable/block geocoding or routing: map/custom-label selection must remain available, routing failure must show no invented road line, and the confirmed schedule must remain pending route review.
7. With a passenger account, verify that only the trip route's approved designated pickup points are requestable. Unapproved routes, inactive stops and stops from other routes remain rejected by the database.
