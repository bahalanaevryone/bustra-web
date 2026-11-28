import { useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents } from 'react-leaflet'
import { divIcon, latLngBounds } from 'leaflet'
import type { Coordinate } from '../map/routeGeometry'
import { getRouteGuides } from '../map/routeGeometry'
import { requestRoadRoute, routingConfigured } from '../map/roadRouting'
import type { Route } from '../../types'
import { errorMessage } from '../../lib/utils'
function WaypointPicker({
  active,
  onPlace,
}: {
  active: boolean
  onPlace: (point: Coordinate) => void
}) {
  useMapEvents({
    click: (event) => {
      if (active) onPlace([event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}

export function RouteReview({
  route,
  path,
  onPath,
}: {
  route?: Route
  path: Coordinate[] | null
  onPath: (path: Coordinate[] | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [approved, setApproved] = useState(route?.is_approved === true)
  const [via, setVia] = useState<Coordinate[]>([])
  const [choosing, setChoosing] = useState(false)
  const guide =
    route &&
    getRouteGuides({
      routes: [route],
      trips: [],
      buses: [],
      locations: [],
    })[0]
  async function preview() {
    if (!guide?.ordered) return
    setBusy(true)
    setError('')
    setApproved(false)
    try {
      onPath(
        (await requestRoadRoute([guide.coordinates[0], ...via, guide.coordinates.at(-1)!]))
          .coordinates,
      )
    } catch (e) {
      setError(errorMessage(e))
      onPath(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="route-review">
      <p className="form-help">
        Review the proposed road path with the transport operator before approving it for bus
        service. A driving route alone is not bus approval.
      </p>
      <button
        type="button"
        className="button button-outline button-small"
        disabled={!routingConfigured() || !guide?.ordered || busy}
        onClick={() => void preview()}
      >
        {busy ? 'Finding road path…' : 'Preview road route'}
      </button>
      <button
        type="button"
        className="button button-outline button-small"
        disabled={!guide?.ordered || via.length >= 23 || busy}
        onClick={() => setChoosing(true)}
      >
        Choose road waypoint
      </button>
      {via.length > 0 && (
        <button
          type="button"
          className="button button-outline button-small"
          onClick={() => {
            setVia([])
            setApproved(false)
            onPath(null)
          }}
        >
          Clear road waypoints
        </button>
      )}
      <p className="form-help">
        If the suggested route misses the roads actually used by the bus, choose waypoints in travel
        order, preview the road route again, then review and save it. {via.length} waypoint(s)
        selected.
      </p>
      {choosing && <p role="status">Click the actual road the bus uses to add a waypoint.</p>}
      {!route && (
        <p className="form-help">
          Save confirmed route endpoints, then reopen the route for review.
        </p>
      )}
      {!routingConfigured() && (
        <p className="form-help">
          Road routing is not configured. Configure an OSRM-compatible routing provider before
          reviewing a path.
        </p>
      )}
      {(path || guide?.ordered) && (
        <MapContainer
          key={JSON.stringify(path)}
          bounds={latLngBounds(path || guide!.coordinates)}
          boundsOptions={{ padding: [15, 15] }}
          className="route-review-map"
          scrollWheelZoom={false}
        >
          <TileLayer
            url={
              import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
            }
            attribution="&copy; OpenStreetMap contributors · Routing: OSRM"
          />
          <WaypointPicker
            active={choosing}
            onPlace={(point) => {
              setVia((v) => [...v, point])
              setChoosing(false)
              setApproved(false)
              onPath(null)
            }}
          />
          {path && <Polyline positions={path} pathOptions={{ color: '#2766dc', weight: 4 }} />}
          {via.map((point, index) => (
            <Marker
              key={index}
              position={point}
              title={`Road waypoint ${index + 1}`}
              icon={divIcon({
                className: 'schedule-pin-wrapper',
                html: `<span class="schedule-pin">${index + 1}</span>`,
                iconSize: [36, 42],
                iconAnchor: [18, 38],
              })}
            />
          ))}
        </MapContainer>
      )}
      <label className="checkbox-field">
        <input
          type="checkbox"
          name="is_approved"
          disabled={!route || !path}
          checked={approved && !!path}
          onChange={(e) => setApproved(e.target.checked)}
        />{' '}
        Operator verified this road path for bus service
      </label>
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
