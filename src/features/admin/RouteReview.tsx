import { useState } from 'react'
import { MapContainer, Polyline, TileLayer } from 'react-leaflet'
import { latLngBounds } from 'leaflet'
import type { Coordinate } from '../map/routeGeometry'
import { getRouteGuides } from '../map/routeGeometry'
import { requestRoadRoute, routingConfigured } from '../map/roadRouting'
import type { Route } from '../../types'
import { errorMessage } from '../../lib/utils'

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
      onPath((await requestRoadRoute(guide.coordinates)).coordinates)
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
      {path && (
        <MapContainer
          key={JSON.stringify(path)}
          bounds={latLngBounds(path)}
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
          <Polyline positions={path} pathOptions={{ color: '#2766dc', weight: 4 }} />
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
