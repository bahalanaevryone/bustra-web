import { useEffect } from 'react'
import { divIcon, latLngBounds } from 'leaflet'
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { Coordinate } from '../map/routeGeometry'
import type { BusLocation, Route } from '../../types'
import { getRouteGuides, validCoordinate } from '../map/routeGeometry'
import { isFresh, locationAge } from '../../lib/utils'

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
  const boundsKey = JSON.stringify(initial)
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  useEffect(() => {
    const points = [...initial, ...(pin ? [pin] : [])]
    if (points.length) map.fitBounds(latLngBounds(points), { padding: [35, 35], maxZoom: 16 })
  }, [boundsKey, pin?.[0], pin?.[1], map])
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
  roadPath,
  location,
  label = 'Choose pickup location on map',
}: {
  route?: Route
  pin: Coordinate | null
  onPlace: (p: Coordinate) => void
  disabled: boolean
  roadPath?: Coordinate[]
  location?: BusLocation | null
  label?: string
}) {
  const guide = route && getRouteGuides({ routes: [route], trips: [], buses: [], locations: [] })[0]
  const path = roadPath ?? guide?.roadPath
  const busPoint: Coordinate | null =
    location && validCoordinate(location.latitude, location.longitude)
      ? [location.latitude, location.longitude]
      : null
  return (
    <div role="region" aria-label={label}>
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
          initial={[...(path || guide?.coordinates || []), ...(busPoint ? [busPoint] : [])]}
          onPlace={onPlace}
          disabled={disabled}
        />
        {path && (
          <Polyline
            positions={path}
            pathOptions={{ color: guide?.approved ? '#287b59' : '#2766dc', weight: 4 }}
          />
        )}
        {guide?.coordinates.map((point, index) => (
          <Marker
            key={index}
            position={point}
            title={index === 0 ? 'Assigned route origin' : 'Assigned route destination'}
            icon={divIcon({
              className: 'schedule-pin-wrapper',
              html: `<span class="schedule-pin schedule-pin-${index === 0 ? 'origin' : 'destination'}">${index === 0 ? 'A' : 'B'}</span>`,
              iconSize: [36, 42],
              iconAnchor: [18, 38],
            })}
          />
        ))}
        {busPoint && location && (
          <>
            <Marker
              position={busPoint}
              title="Reported bus GPS"
              alt="Reported bus GPS"
              icon={divIcon({
                className: 'schedule-pin-wrapper',
                html: `<span class="schedule-pin" style="background:${isFresh(location.updated_at) ? '#2766dc' : '#6b7280'}">Bus</span>`,
                iconSize: [36, 42],
                iconAnchor: [18, 38],
              })}
            >
              <Popup>
                Reported bus GPS
                <br />
                {locationAge(location.updated_at)}
                <br />
                Accuracy: {location.accuracy_m ?? 'unknown'} m
              </Popup>
            </Marker>
            {location.accuracy_m != null && location.accuracy_m <= 1000 && (
              <Circle
                center={busPoint}
                radius={location.accuracy_m}
                pathOptions={{ color: '#2766dc', weight: 1, fillOpacity: 0.08 }}
              />
            )}
          </>
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
