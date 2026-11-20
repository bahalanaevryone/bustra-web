import type { PublicFeed } from '../../types'
export type Coordinate = [number, number]
export interface RouteGuide {
  routeId: string
  name: string
  origin: string
  destination: string
  coordinates: Coordinate[]
  ordered: boolean
  approved: boolean
  roadPath: Coordinate[] | null
}
export function validCoordinate(latitude: unknown, longitude: unknown) {
  if (latitude == null || longitude == null || latitude === '' || longitude === '') return false
  const lat = Number(latitude),
    lng = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}
export function getRouteGuides(
  feed: PublicFeed,
  selectedTrip?: string,
  selectedRoute?: string,
): RouteGuide[] {
  const focused = selectedRoute || feed.trips.find((t) => t.id === selectedTrip)?.route_id
  return feed.routes
    .filter((r) => !focused || r.id === focused)
    .map((route) => {
      const coordinates: Coordinate[] = []
      const add = (lat: unknown, lng: unknown) => {
        if (!validCoordinate(lat, lng)) return
        const p: Coordinate = [Number(lat), Number(lng)]
        if (!coordinates.length || distanceKm(coordinates[coordinates.length - 1], p) > 0.001)
          coordinates.push(p)
      }
      add(route.origin_lat ?? route.origin_latitude, route.origin_lng ?? route.origin_longitude)
      add(
        route.destination_lat ?? route.destination_latitude,
        route.destination_lng ?? route.destination_longitude,
      )
      const ordered = coordinates.length >= 2
      const roadPath =
        Array.isArray(route.road_path) &&
        route.road_path.length >= 2 &&
        route.road_path.every(
          (p) => Array.isArray(p) && p.length === 2 && validCoordinate(p[0], p[1]),
        )
          ? route.road_path
          : null
      return {
        routeId: route.id,
        name: route.route_name,
        origin: route.origin,
        destination: route.destination,
        ordered,
        coordinates: ordered ? coordinates : [],
        approved: route.is_approved === true && !!roadPath,
        roadPath,
      }
    })
}
export function distanceKm(a: Coordinate, b: Coordinate) {
  const radians = Math.PI / 180,
    dLat = (b[0] - a[0]) * radians,
    dLng = (b[1] - a[1]) * radians
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}
export function farFromRoute(position: Coordinate, guide?: RouteGuide) {
  return !!guide?.coordinates.length && guide.coordinates.every((p) => distanceKm(position, p) > 50)
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
