import { useEffect } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  CircleMarker,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { divIcon, latLngBounds } from 'leaflet'
import type { Coordinate } from '../map/routeGeometry'
import type { SelectedLocation } from './scheduleRoutes'
import type { PickupPoint } from '../../types'
export type Endpoint = 'origin' | 'destination'
function Controls({
  points,
  active,
  onPlace,
  disabled,
}: {
  points: Coordinate[]
  active: Endpoint | null
  onPlace: (kind: Endpoint, p: Coordinate) => void
  disabled: boolean
}) {
  const map = useMap()
  const key = JSON.stringify(points)
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  useEffect(() => {
    if (points.length) map.fitBounds(latLngBounds(points), { padding: [35, 35], maxZoom: 16 })
  }, [key, map])
  useMapEvents({
    click: (event) => {
      if (active && !disabled) onPlace(active, [event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}
export function ScheduleMap({
  origin,
  destination,
  path,
  approved,
  stops,
  active,
  onPlace,
  disabled = false,
}: {
  origin: SelectedLocation | null
  destination: SelectedLocation | null
  path: Coordinate[] | null
  approved: boolean
  stops: PickupPoint[]
  active: Endpoint | null
  onPlace: (kind: Endpoint, p: Coordinate) => void
  disabled?: boolean
}) {
  const locations = { origin, destination }
  const points =
    path ||
    [origin && [origin.lat, origin.lng], destination && [destination.lat, destination.lng]].filter(
      (p): p is Coordinate => !!p,
    )
  return (
    <div
      className={`schedule-map-canvas ${active ? 'choosing-position' : ''}`}
      role="region"
      aria-label="Schedule location and route preview"
    >
      <MapContainer
        center={[
          Number(import.meta.env.VITE_MAP_LAT || 13.2233),
          Number(import.meta.env.VITE_MAP_LNG || 120.596),
        ]}
        zoom={13}
        className="schedule-route-map"
        scrollWheelZoom={false}
      >
        <TileLayer
          url={
            import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
          }
          attribution={
            import.meta.env.VITE_MAP_ATTRIBUTION ||
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
        />
        <Controls points={points} active={active} onPlace={onPlace} disabled={disabled} />
        {path && (
          <Polyline
            positions={path}
            pathOptions={{ color: approved ? '#237b54' : '#2164df', weight: 5, opacity: 0.85 }}
          />
        )}
        {(['origin', 'destination'] as const).map((kind) => {
          const p = locations[kind]
          if (!p) return null
          return (
            <Marker
              key={kind}
              position={[p.lat, p.lng]}
              draggable={!disabled}
              title={`${kind === 'origin' ? 'Origin' : 'Destination'} marker`}
              alt={`${kind === 'origin' ? 'Origin' : 'Destination'} marker`}
              icon={divIcon({
                className: 'schedule-pin-wrapper',
                html: `<span class="schedule-pin schedule-pin-${kind}">${kind === 'origin' ? 'A' : 'B'}</span>`,
                iconSize: [36, 42],
                iconAnchor: [18, 38],
              })}
              eventHandlers={{
                dragend: (event) => {
                  const pos = event.target.getLatLng()
                  onPlace(kind, [pos.lat, pos.lng])
                },
                keydown: (event) => {
                  if (disabled) return
                  const e = event.originalEvent,
                    steps: Record<string, Coordinate> = {
                      ArrowUp: [0.0001, 0],
                      ArrowDown: [-0.0001, 0],
                      ArrowLeft: [0, -0.0001],
                      ArrowRight: [0, 0.0001],
                    }
                  const delta = steps[e.key]
                  if (delta) {
                    e.preventDefault()
                    e.stopPropagation()
                    onPlace(kind, [
                      Math.max(-90, Math.min(90, p.lat + delta[0])),
                      Math.max(-180, Math.min(180, p.lng + delta[1])),
                    ])
                  }
                },
              }}
            >
              <Popup>
                <strong>{kind === 'origin' ? 'Origin' : 'Destination'}</strong>
                <p>{p.label || 'Add a location label for this pin.'}</p>
                <p>
                  {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
                </p>
              </Popup>
            </Marker>
          )
        })}
        {stops.map((p) => (
          <CircleMarker
            key={p.id}
            center={[Number(p.latitude), Number(p.longitude)]}
            radius={6}
            pathOptions={{ color: approved ? '#237b54' : '#75869b', fillOpacity: 1 }}
          >
            <Popup>
              {p.name}
              <p>
                {approved
                  ? 'Designated stop on the existing reviewed route.'
                  : 'Stop awaiting route review; pickup is not enabled.'}
              </p>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {active && (
        <div className="schedule-map-instruction">
          Tap the map to place the {active === 'origin' ? 'Origin (A)' : 'Destination (B)'} pin
        </div>
      )}
    </div>
  )
}
