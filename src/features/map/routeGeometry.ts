import type { PickupPoint, MapRequest, PublicFeed, Route } from '../../types'
export type Coordinate = [number, number]
export interface RouteGuide {
  routeId: string
  name: string
  origin: string
  destination: string
  stops: PickupPoint[]
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
      const stops = feed.pickup_points
        .filter(
          (p) => p.route_id === route.id && p.is_active && validCoordinate(p.latitude, p.longitude),
        )
        .sort((a, b) => a.stop_order - b.stop_order || a.id.localeCompare(b.id))
      const coordinates: Coordinate[] = []
      const add = (lat: unknown, lng: unknown) => {
        if (!validCoordinate(lat, lng)) return
        const p: Coordinate = [Number(lat), Number(lng)]
        if (!coordinates.length || distanceKm(coordinates[coordinates.length - 1], p) > 0.001)
          coordinates.push(p)
      }
      add(route.origin_lat ?? route.origin_latitude, route.origin_lng ?? route.origin_longitude)
      for (const p of stops) add(p.latitude, p.longitude)
      add(
        route.destination_lat ?? route.destination_latitude,
        route.destination_lng ?? route.destination_longitude,
      )
      const ordered =
        coordinates.length >= 2 && new Set(stops.map((p) => p.stop_order)).size === stops.length
      const roadPath =
        route.is_approved === true &&
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
        stops,
        ordered,
        coordinates: ordered ? coordinates : [],
        approved: route.is_approved === true && !!roadPath,
        roadPath,
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
export function validPickupPoints(route: Route | undefined, points: PickupPoint[]) {
  if (
    !route?.is_approved ||
    !Array.isArray(route.road_path) ||
    route.road_path.length < 2 ||
    route.road_path.some((p) => !Array.isArray(p) || p.length !== 2 || !validCoordinate(p[0], p[1]))
  )
    return []
  const path = route.road_path
  return points.filter((p) => {
    if (p.route_id !== route.id || !p.is_active || !validCoordinate(p.latitude, p.longitude))
      return false
    const scale = 111195 * Math.cos((Number(p.latitude) * Math.PI) / 180)
    for (let i = 0; i < path.length - 1; i++) {
      const ax = (path[i][1] - Number(p.longitude)) * scale,
        ay = (path[i][0] - Number(p.latitude)) * 111195
      const bx = (path[i + 1][1] - Number(p.longitude)) * scale,
        by = (path[i + 1][0] - Number(p.latitude)) * 111195
      const dx = bx - ax,
        dy = by - ay,
        t =
          dx * dx + dy * dy
            ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
            : 0
      if (Math.hypot(ax + t * dx, ay + t * dy) <= 100) return true
    }
    return false
  })
}
