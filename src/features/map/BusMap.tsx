import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { divIcon, latLngBounds } from 'leaflet'
import { useEffect, useState } from 'react'
import { Crosshair, Expand, MapPin } from 'lucide-react'
import type { PublicFeed } from '../../types'
import { isFresh, locationAge } from '../../lib/utils'

const center: [number, number] = [
  Number(import.meta.env.VITE_MAP_LAT || 13.2233),
  Number(import.meta.env.VITE_MAP_LNG || 120.596),
]
function ViewController({
  position,
  feed,
  selected,
}: {
  position: [number, number] | null
  feed: PublicFeed
  selected?: string
}) {
  const map = useMap()
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  useEffect(() => {
    if (position) map.flyTo(position, 15)
  }, [position, map])
  useEffect(() => {
    const location = feed.locations.find((l) => l.trip_id === selected)
    if (location) map.flyTo([Number(location.latitude), Number(location.longitude)], 15)
  }, [selected, feed.locations, map])
  return null
}
function FitButton({ feed }: { feed: PublicFeed }) {
  const map = useMap()
  return (
    <button
      className="map-fit icon-button"
      aria-label="Fit map to all buses and pickup points"
      onClick={() => {
        const points = [...feed.locations, ...feed.pickup_points].map(
          (p) => [Number(p.latitude), Number(p.longitude)] as [number, number],
        )
        if (points.length) map.fitBounds(latLngBounds(points), { padding: [45, 45], maxZoom: 15 })
        else map.setView(center, 13)
      }}
    >
      <Expand size={18} />
    </button>
  )
}
export function BusMap({
  feed,
  selected,
  onSelect,
  demo = false,
  large = false,
}: {
  feed: PublicFeed
  selected?: string
  onSelect?: (id: string) => void
  demo?: boolean
  large?: boolean
}) {
  const [position, setPosition] = useState<[number, number] | null>(null)
  const [error, setError] = useState('')
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 30000)
    return () => clearInterval(id)
  }, [])
  const activeLocations = feed.locations.filter((l) =>
    feed.trips.some((t) => t.id === l.trip_id && t.status === 'active'),
  )
  function locate() {
    if (!navigator.geolocation) {
      setError('This browser does not support location.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition([p.coords.latitude, p.coords.longitude])
        setError('')
      },
      (e) =>
        setError(
          e.code === 1
            ? 'Location permission was denied. You can still browse the map.'
            : 'Unable to find your location. Try again outdoors.',
        ),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }
  return (
    <div
      className={`map-shell ${large ? 'map-large' : ''}`}
      role="region"
      aria-label="Bus locations and pickup points"
    >
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
        <ViewController position={position} feed={feed} selected={selected} />
        <FitButton feed={feed} />
        {feed.pickup_points
          .filter((p) => p.is_active)
          .map((p) => (
            <CircleMarker
              key={p.id}
              center={[Number(p.latitude), Number(p.longitude)]}
              radius={6}
              pathOptions={{ color: '#2870dd', fillColor: '#fff', fillOpacity: 1, weight: 3 }}
            >
              <Popup>
                <strong>{p.name}</strong>
                <p>Designated pickup point{demo ? ' · DEMO' : ''}</p>
              </Popup>
            </CircleMarker>
          ))}
        {activeLocations.map((l) => {
          const trip = feed.trips.find((t) => t.id === l.trip_id)!
          const bus = feed.buses.find((b) => b.id === trip.bus_id)
          const fresh = !demo && isFresh(l.updated_at)
          return (
            <Marker
              key={l.trip_id}
              title={`${bus?.plate_number || 'Bus'} · ${fresh ? 'Recent location' : 'Outdated location'}`}
              position={[Number(l.latitude), Number(l.longitude)]}
              icon={divIcon({
                className: 'bus-marker-wrapper',
                html: `<span class="bus-marker ${fresh ? '' : 'stale'}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 11h14M8 20v2m8-2v2M9 6h6"/><circle cx="8.5" cy="16" r="1"/><circle cx="15.5" cy="16" r="1"/></svg></span>`,
                iconSize: [42, 48],
                iconAnchor: [21, 48],
              })}
              eventHandlers={{ click: () => onSelect?.(trip.id) }}
            >
              <Popup>
                <strong>{bus?.plate_number}</strong>
                <p>{feed.routes.find((r) => r.id === trip.route_id)?.route_name}</p>
                <p>
                  {trip.onboard_count} / {bus?.capacity} aboard ·{' '}
                  {demo ? 'Illustrative location' : locationAge(l.updated_at)}
                </p>
                {!fresh && <p>Location is outdated. Current position is unknown.</p>}
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
          <CircleMarker
            center={position}
            radius={8}
            pathOptions={{ color: '#fff', fillColor: '#2563eb', fillOpacity: 1 }}
          >
            <Popup>Your position · only visible to you</Popup>
          </CircleMarker>
        )}
      </MapContainer>
      <div className="map-top-label">
        <MapPin size={14} />
        {demo ? 'Illustrative demo positions' : 'Mamburao & surrounding area'}
      </div>
      <button className="map-locate" onClick={locate}>
        <Crosshair size={17} /> Locate me
      </button>
      {!activeLocations.length && (
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
  )
}
