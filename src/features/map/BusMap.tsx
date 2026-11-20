import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { divIcon, latLngBounds } from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Crosshair,
  Expand,
  MapPin,
  BusFront,
  Users,
  Route as RouteIcon,
  Navigation,
  LoaderCircle,
} from 'lucide-react'
import type { MapRequest, PublicFeed } from '../../types'
import { isFresh, locationAge } from '../../lib/utils'
import { escapeHtml, farFromRoute, getRouteGuides, validCoordinate } from './routeGeometry'
import type { Coordinate } from './routeGeometry'
import { requestRoadRoute, routingConfigured } from './roadRouting'
import type { RoadRoute } from './roadRouting'
import { liveMapFeed } from './liveMap'

const center: Coordinate = [
  Number(import.meta.env.VITE_MAP_LAT || 13.2233),
  Number(import.meta.env.VITE_MAP_LNG || 120.596),
]
const busSvg =
  '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 11h14M8 20v2m8-2v2M9 6h6"/><circle cx="8.5" cy="16" r="1"/><circle cx="15.5" cy="16" r="1"/></svg>'
const personSvg =
  '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M9 15v6m6-6v6"/></svg>'
function simpleIcon(kind: string, content: string) {
  return divIcon({
    className: 'map-symbol-wrapper',
    html: `<span class="map-symbol map-symbol-${kind}">${content}</span>`,
    iconSize: [32, 38],
    iconAnchor: [16, 35],
  })
}

function MapView({
  position,
  initialPoints,
  selectionPoints,
  selectionKey,
  busPosition,
  busKey,
  pickup,
}: {
  position: Coordinate | null
  initialPoints: Coordinate[]
  selectionPoints: Coordinate[]
  selectionKey: string
  busPosition?: Coordinate
  busKey: string
  pickup?: MapRequest
}) {
  const map = useMap()
  const fitted = useRef(false)
  const previousSelection = useRef('')
  const previousBus = useRef('')
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  useEffect(() => {
    if (!fitted.current && initialPoints.length) {
      map.fitBounds(latLngBounds(initialPoints), { padding: [45, 45], maxZoom: 14 })
      fitted.current = true
    }
  }, [initialPoints, map])
  useEffect(() => {
    if (selectionKey !== previousSelection.current && selectionPoints.length) {
      map.fitBounds(latLngBounds(selectionPoints), { padding: [50, 50], maxZoom: 15 })
      previousSelection.current = selectionKey
    }
  }, [selectionKey, selectionPoints, map])
  useEffect(() => {
    if (position) map.flyTo(position, 16)
  }, [position, map])
  useEffect(() => {
    if (pickup) map.flyTo([Number(pickup.pickup_latitude), Number(pickup.pickup_longitude)], 17)
  }, [pickup, map])
  useEffect(() => {
    if (busKey && busKey !== previousBus.current && busPosition) {
      map.flyTo(busPosition, 16)
      previousBus.current = busKey
    }
  }, [busKey, busPosition, map])
  return null
}
function FitButton({ points }: { points: Coordinate[] }) {
  const map = useMap()
  return (
    <button
      className="map-fit icon-button"
      aria-label="Fit map to all buses and pickup points"
      onClick={() =>
        points.length
          ? map.fitBounds(latLngBounds(points), { padding: [50, 50], maxZoom: 15 })
          : map.setView(center, 13)
      }
    >
      <Expand size={18} />
    </button>
  )
}

export function BusMap({
  feed: sourceFeed,
  selected,
  onSelect,
  demo = false,
  large = false,
  waitingRequests = [],
  selectedRoute,
  focusedPickup,
}: {
  feed: PublicFeed
  selected?: string
  onSelect?: (id: string) => void
  demo?: boolean
  large?: boolean
  waitingRequests?: MapRequest[]
  selectedRoute?: string
  focusedPickup?: MapRequest
}) {
  const feed = useMemo(() => liveMapFeed(sourceFeed), [sourceFeed])
  const [position, setPosition] = useState<Coordinate | null>(null)
  const [positionAccuracy, setPositionAccuracy] = useState(0)
  const [error, setError] = useState('')
  const [locating, setLocating] = useState(false)
  const [findBus, setFindBus] = useState(0)
  const [roadRoutes, setRoadRoutes] = useState<Record<string, RoadRoute>>({})
  const [routing, setRouting] = useState(false)
  const [routingError, setRoutingError] = useState('')
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 30000)
    return () => clearInterval(id)
  }, [])
  const guides = useMemo(
    () => getRouteGuides(feed, selected, selectedRoute),
    [feed.routes, feed.trips, selected, selectedRoute],
  )
  const routeIds = new Set(guides.map((g) => g.routeId))
  const routeKey = (routeId: string) =>
    JSON.stringify(guides.find((g) => g.routeId === routeId)?.coordinates || [])
  const activeTrips = feed.trips.filter((t) => t.status === 'active' && routeIds.has(t.route_id))
  const locations = feed.locations.filter(
    (l) => activeTrips.some((t) => t.id === l.trip_id) && validCoordinate(l.latitude, l.longitude),
  )
  const selectedLocation = locations.find((l) => l.trip_id === selected)
  const focusedLocation = selectedLocation || locations[0]
  const points = guides.flatMap((g) => g.roadPath || g.coordinates)
  const initialPoints = points.length
    ? points
    : locations.map((l) => [Number(l.latitude), Number(l.longitude)] as Coordinate)
  const selectionKey = `${selectedRoute || selected || 'all'}:${activeTrips
    .map((trip) => trip.id)
    .sort()
    .join(',')}`
  const completePoints = [
    ...points,
    ...locations.map((l) => [Number(l.latitude), Number(l.longitude)] as Coordinate),
  ]
  const missing = activeTrips.filter((t) => !locations.some((l) => l.trip_id === t.id))
  const pending = waitingRequests.filter(
    (r) => r.status === 'pending' && activeTrips.some((t) => t.id === r.trip_id),
  ).length
  async function locate() {
    if (!navigator.geolocation) {
      setError('This browser does not support location.')
      return
    }
    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition([p.coords.latitude, p.coords.longitude])
        setPositionAccuracy(p.coords.accuracy)
        setLocating(false)
      },
      (e) => {
        setLocating(false)
        setError(
          e.code === 1
            ? 'Location permission was denied. Allow location access in browser settings.'
            : 'Your device could not provide a location. Enable device Location and try again. Bus sharing has separate controls.',
        )
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }
  async function traceRoads() {
    setRouting(true)
    setRoutingError('')
    try {
      // Routing receives route endpoints, never passenger or device GPS.
      for (const guide of guides.filter((g) => g.ordered && !g.approved && !g.roadPath)) {
        const key = JSON.stringify(guide.coordinates)
        const road = await requestRoadRoute(guide.coordinates)
        setRoadRoutes((previous) => ({ ...previous, [key]: road }))
      }
    } catch (e) {
      setRoutingError(e instanceof Error ? e.message : 'Road routing is unavailable.')
    } finally {
      setRouting(false)
    }
  }
  const hasLine = guides.some((g) => g.ordered || g.roadPath)
  const geometryKey = JSON.stringify(guides.map((g) => [g.routeId, g.coordinates, g.approved]))
  useEffect(() => {
    if (demo || !routingConfigured()) return
    let disposed = false
    setRoutingError('')
    void (async () => {
      for (const guide of guides.filter((g) => g.ordered && !g.approved && !g.roadPath)) {
        if (disposed) return
        try {
          const road = await requestRoadRoute(guide.coordinates)
          if (!disposed)
            setRoadRoutes((previous) => ({
              ...previous,
              [JSON.stringify(guide.coordinates)]: road,
            }))
        } catch (e) {
          if (!disposed)
            setRoutingError(e instanceof Error ? e.message : 'Road routing is unavailable.')
        }
      }
    })()
    return () => {
      disposed = true
    }
  }, [geometryKey, demo])
  return (
    <div
      className={`map-shell ${large ? 'map-large' : ''} map-with-details`}
      role="region"
      aria-label="Bus locations and pickup points"
    >
      <div className="map-canvas">
        <MapContainer center={center} zoom={13} scrollWheelZoom={false} className="bus-map">
          <TileLayer
            url={
              import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
            }
            attribution={
              import.meta.env.VITE_MAP_ATTRIBUTION ||
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
          />
          <MapView
            position={position}
            pickup={
              focusedPickup && activeTrips.some((trip) => trip.id === focusedPickup.trip_id)
                ? focusedPickup
                : undefined
            }
            initialPoints={initialPoints}
            selectionPoints={initialPoints}
            selectionKey={selectionKey}
            busPosition={
              focusedLocation
                ? [Number(focusedLocation.latitude), Number(focusedLocation.longitude)]
                : undefined
            }
            busKey={findBus ? `${focusedLocation?.trip_id}-${findBus}` : ''}
          />
          <FitButton points={completePoints} />
          {guides
            .filter((g) => g.ordered || g.roadPath)
            .map((guide) => {
              const road = roadRoutes[routeKey(guide.routeId)]
              return (
                <Polyline
                  key={guide.routeId}
                  positions={guide.roadPath || road?.coordinates || guide.coordinates}
                  pathOptions={{
                    color: guide.approved ? '#287b59' : '#2766dc',
                    weight: guide.roadPath || road ? 5 : 4,
                    opacity: 0.8,
                    dashArray: guide.roadPath || road ? undefined : '9 9',
                  }}
                >
                  <Popup>
                    <strong>{guide.name}</strong>
                    <p>
                      {guide.origin} → {guide.destination}
                    </p>
                    <p>
                      {guide.approved
                        ? 'Operator-reviewed road path. Each passenger pickup still needs driver review.'
                        : guide.roadPath || road
                          ? 'Suggested driving path only. This road path is not approved for bus service.'
                          : 'Endpoint guide only. Dashed segments do not represent a road route.'}
                    </p>
                  </Popup>
                </Polyline>
              )
            })}
          {guides.flatMap((guide) =>
            guide.ordered
              ? [0, guide.coordinates.length - 1].map((index, i) => {
                  const position = guide.coordinates[index]
                  return (
                    <Marker
                      key={`${guide.routeId}-endpoint-${i}`}
                      position={position}
                      icon={simpleIcon(i === 0 ? 'origin' : 'destination', i === 0 ? 'A' : 'B')}
                      title={i === 0 ? 'Origin' : 'Destination'}
                    >
                      <Popup>
                        {i === 0 ? guide.origin : guide.destination}
                        <p>Route endpoint. Choose your pickup pin and wait for driver review.</p>
                      </Popup>
                    </Marker>
                  )
                })
              : [],
          )}
          {waitingRequests
            .filter(
              (r) =>
                (r.status === 'pending' || r.status === 'accepted') &&
                activeTrips.some((t) => t.id === r.trip_id) &&
                validCoordinate(r.pickup_latitude, r.pickup_longitude),
            )
            .map((r) => (
              <Marker
                key={r.id}
                position={[Number(r.pickup_latitude), Number(r.pickup_longitude)]}
                title={
                  r.status === 'pending' ? 'Pending passenger pickup' : 'Accepted passenger pickup'
                }
                icon={simpleIcon(r.status === 'pending' ? 'waiting' : 'accepted', personSvg)}
              >
                <Popup>
                  <strong>{r.pickup_address || 'Selected pickup location'}</strong>
                  <p>
                    {Number(r.pickup_latitude).toFixed(6)}, {Number(r.pickup_longitude).toFixed(6)}
                  </p>
                  <p>{r.status} - driver review required for safe stopping.</p>
                </Popup>
              </Marker>
            ))}
          {locations.map((location) => {
            const trip = activeTrips.find((t) => t.id === location.trip_id)!
            const bus = feed.buses.find((b) => b.id === trip.bus_id)
            const fresh = !demo && isFresh(location.updated_at)
            const far = farFromRoute(
              [Number(location.latitude), Number(location.longitude)],
              guides.find((g) => g.routeId === trip.route_id),
            )
            return (
              <Marker
                key={location.trip_id}
                title={`${bus?.plate_number || 'Bus'} · ${fresh ? 'Recent location' : 'Outdated location'}`}
                alt={`Bus ${bus?.plate_number || ''}`}
                position={[Number(location.latitude), Number(location.longitude)]}
                zIndexOffset={1000}
                icon={divIcon({
                  className: 'bus-marker-wrapper',
                  html: `<span class="bus-marker ${fresh ? '' : 'stale'}">${busSvg}</span><span class="bus-plate-label">${escapeHtml(bus?.plate_number || 'Bus')}</span>`,
                  iconSize: [44, 65],
                  iconAnchor: [22, 44],
                })}
                eventHandlers={{ click: () => onSelect?.(trip.id) }}
              >
                <Popup>
                  <strong>
                    <span className="bus-popup-label">BUS</span> {bus?.plate_number}
                  </strong>
                  <p>{feed.routes.find((r) => r.id === trip.route_id)?.route_name}</p>
                  <p>
                    {trip.onboard_count} / {bus?.capacity} aboard
                  </p>
                  <p>{demo ? 'Illustrative demo location' : locationAge(location.updated_at)}</p>
                  {!fresh && <p>Last known position only. The current bus position is unknown.</p>}
                  {far && (
                    <p className="danger-text">
                      Reported position is far from the route endpoints. Check the device location.
                    </p>
                  )}
                  <p>
                    {Number(location.latitude).toFixed(6)}, {Number(location.longitude).toFixed(6)}
                    {location.accuracy_m != null ? ` · ±${Math.round(location.accuracy_m)} m` : ''}
                  </p>
                  <button
                    className="button button-primary button-small"
                    onClick={() => onSelect?.(trip.id)}
                  >
                    View bus details
                  </button>
                </Popup>
              </Marker>
            )
          })}
          {position && (
            <>
              <Circle
                center={position}
                radius={positionAccuracy}
                pathOptions={{ color: '#8553c7', weight: 1, fillOpacity: 0.08 }}
              />
              <Marker
                position={position}
                title="Your device location, visible only to you"
                zIndexOffset={500}
                icon={simpleIcon('you', personSvg)}
              >
                <Tooltip permanent direction="bottom" className="stop-label">
                  You
                </Tooltip>
                <Popup>
                  Your device location · accuracy ±{Math.round(positionAccuracy)} m · only visible
                  to you
                </Popup>
              </Marker>
            </>
          )}
        </MapContainer>
        <div className="map-top-label">
          <MapPin size={14} />
          {demo ? 'Illustrative demo positions' : 'Active trips & reported locations'}
        </div>
        <div className="map-bottom-actions">
          <button
            className="map-locate"
            disabled={locating}
            onClick={() => {
              void locate()
            }}
          >
            {locating ? <LoaderCircle size={17} className="spin" /> : <Crosshair size={17} />}{' '}
            Locate me
          </button>
          <button
            className="map-find-bus"
            disabled={!focusedLocation}
            onClick={() => setFindBus((v) => v + 1)}
          >
            <BusFront size={17} /> Find bus
          </button>
        </div>
        {!locations.length && (
          <div className="map-empty-label">No active bus locations are being shared.</div>
        )}
        {error && (
          <div className="map-error" role="alert">
            {error}
            <button aria-label="Dismiss location error" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
      </div>
      <div className="map-details">
        <div className="map-legend" aria-label="Map symbols">
          <span>
            <BusFront size={16} className="legend-bus" /> Bus <i className="legend-stale-dot" />{' '}
            grey = outdated
          </span>
          <span>
            <Users size={16} className="legend-waiting" /> Waiting request
          </span>
          <span>
            <Navigation size={15} className="legend-you" /> You
          </span>
          <span>
            <b className="legend-origin">A</b> Origin <b className="legend-destination">B</b>{' '}
            Destination
          </span>
        </div>
        <div className="map-route-summary">
          {guides.length === 1 ? (
            <span>
              <strong>{guides[0].origin}</strong> <span aria-label="to">→</span>{' '}
              <strong>{guides[0].destination}</strong>
            </span>
          ) : (
            <span>
              {guides.length} active route{guides.length === 1 ? '' : 's'}
            </span>
          )}
          {hasLine && routingConfigured() && guides.some((g) => !g.approved) && (
            <button
              className="text-button"
              disabled={routing}
              onClick={() => {
                void traceRoads()
              }}
            >
              <RouteIcon size={15} />
              {routing ? 'Tracing road…' : 'Trace road route'}
            </button>
          )}
        </div>
        <p className="map-route-note">
          {guides.some((g) => g.approved)
            ? 'Green line: operator-reviewed bus route. Pickup locations need driver review.'
            : ''}{' '}
          {guides.some((g) => !g.approved && g.roadPath) ||
          Object.keys(roadRoutes).some((key) =>
            guides.some((g) => routeKey(g.routeId) === key && !g.approved),
          )
            ? 'Blue line: suggested driving path, not approved for bus service. Routing: OSRM / OpenStreetMap.'
            : hasLine
              ? 'Dashed line: endpoint guide, not a road route.'
              : guides.length
                ? 'A route guide needs confirmed endpoints.'
                : 'No active trips. Routes appear here when a trip starts.'}
          {!routingConfigured() &&
            !guides.every((g) => g.approved) &&
            ' Road routing is not configured.'}
        </p>
        {guides.some((g) => !g.approved) && (
          <p className="map-route-note">
            Suggested driving directions do not establish bus approval or safe stopping.
          </p>
        )}
        {(pending > 0 || waitingRequests.some((r) => r.status === 'accepted')) && (
          <p className="map-route-note">
            Pickup pins are one-time requested positions visible only to the passenger and assigned
            driver.
          </p>
        )}
        {missing.length > 0 && (
          <p className="map-route-note">
            {missing
              .map((t) => feed.buses.find((b) => b.id === t.bus_id)?.plate_number || 'Bus')
              .join(', ')}
            : active trip, no reported GPS position yet.
          </p>
        )}
        {routingError && guides.length > 0 && (
          <p className="map-route-warning" role="alert">
            {routingError}
          </p>
        )}
      </div>
    </div>
  )
}
