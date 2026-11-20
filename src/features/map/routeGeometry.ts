import type { PickupPoint, MapRequest, PublicFeed } from '../../types'
export type Coordinate = [number, number]
export interface RouteGuide {
  routeId: string
  name: string
  origin: string
  destination: string
  stops: PickupPoint[]
  coordinates: Coordinate[]
  ordered: boolean
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
      const stops = feed.pickup_points
        .filter(
          (p) => p.route_id === route.id && p.is_active && validCoordinate(p.latitude, p.longitude),
        )
        .sort((a, b) => a.stop_order - b.stop_order || a.id.localeCompare(b.id))
      const ordered =
        stops.length >= 2 && new Set(stops.map((p) => p.stop_order)).size === stops.length
      return {
        routeId: route.id,
        name: route.route_name,
        origin: route.origin,
        destination: route.destination,
        stops,
        ordered,
        coordinates: ordered
          ? stops.map((p) => [Number(p.latitude), Number(p.longitude)] as Coordinate)
          : [],
      }
    })
}
export function getWaitingAtStop(requests: MapRequest[], feed: PublicFeed, pointId: string) {
  const active = new Set(feed.trips.filter((t) => t.status === 'active').map((t) => t.id))
  const visible = requests.filter((r) => r.pickup_point_id === pointId && active.has(r.trip_id))
  return {
    pending: visible.filter((r) => r.status === 'pending').length,
    accepted: visible.filter((r) => r.status === 'accepted').length,
  }
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
  return (
    !!guide?.stops.length &&
    guide.stops.every((p) => distanceKm(position, [Number(p.latitude), Number(p.longitude)]) > 50)
  )
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
