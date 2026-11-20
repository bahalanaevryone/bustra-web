import { useEffect } from 'react'
import { divIcon, latLngBounds } from 'leaflet'
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { Coordinate } from '../map/routeGeometry'
import type { Route } from '../../types'
import { getRouteGuides } from '../map/routeGeometry'

function Controls({
  pin,
  initial,
  onPlace,
  disabled,
}: {
  pin: Coordinate | null
  initial: Coordinate[]
  onPlace: (p: Coordinate) => void
  disabled: boolean
}) {
  const map = useMap()
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    if (initial.length) map.fitBounds(latLngBounds(initial), { padding: [35, 35], maxZoom: 15 })
    return () => observer.disconnect()
  }, [map])
  useEffect(() => {
    if (pin) map.panTo(pin)
  }, [pin?.[0], pin?.[1], map])
  useMapEvents({
    click: (e) => {
      if (!disabled) onPlace([e.latlng.lat, e.latlng.lng])
    },
  })
  return null
}
export function PickupMap({
  route,
  pin,
  onPlace,
  disabled,
}: {
  route?: Route
  pin: Coordinate | null
  onPlace: (p: Coordinate) => void
  disabled: boolean
}) {
  const guide = route && getRouteGuides({ routes: [route], trips: [], buses: [], locations: [] })[0]
  return (
    <div role="region" aria-label="Choose pickup location on map">
      <MapContainer
        className="pickup-location-map"
        center={[
          Number(import.meta.env.VITE_MAP_LAT || 13.2233),
          Number(import.meta.env.VITE_MAP_LNG || 120.596),
        ]}
        zoom={13}
        scrollWheelZoom
      >
        <TileLayer
          url={
            import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
          }
          attribution={import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors'}
        />
        <Controls
          pin={pin}
          initial={guide?.roadPath || guide?.coordinates || []}
          onPlace={onPlace}
          disabled={disabled}
        />
        {guide?.roadPath && (
          <Polyline
            positions={guide.roadPath}
            pathOptions={{ color: guide.approved ? '#287b59' : '#2766dc', weight: 4 }}
          />
        )}
        {pin && (
          <Marker
            position={pin}
            draggable={!disabled}
            title="Your selected pickup pin"
            alt="Your selected pickup pin"
            icon={divIcon({
              className: 'schedule-pin-wrapper',
              html: '<span class="schedule-pin pickup-pin">P</span>',
              iconSize: [36, 42],
              iconAnchor: [18, 38],
            })}
            eventHandlers={{
              dragend: (e) => {
                const p = e.target.getLatLng()
                onPlace([p.lat, p.lng])
              },
              keydown: (e) => {
                if (disabled) return
                const steps: Record<string, Coordinate> = {
                  ArrowUp: [0.0001, 0],
                  ArrowDown: [-0.0001, 0],
                  ArrowLeft: [0, -0.0001],
                  ArrowRight: [0, 0.0001],
                }
                const step = steps[e.originalEvent.key]
                if (step) {
                  e.originalEvent.preventDefault()
                  e.originalEvent.stopPropagation()
                  onPlace([pin[0] + step[0], pin[1] + step[1]])
                }
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  )
}
