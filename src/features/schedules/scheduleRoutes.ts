import type { Route } from '../../types'
import { distanceKm, validCoordinate } from '../map/routeGeometry'
export interface SelectedLocation {
  label: string
  lat: number
  lng: number
  source: 'search' | 'map' | 'custom'
}
export const placeKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
export const generatedRouteName = (origin: string, destination: string) =>
  `${origin.trim().replace(/\s+/g, ' ')} → ${destination.trim().replace(/\s+/g, ' ')}`
export function validLocation(p: SelectedLocation | null): p is SelectedLocation {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    validCoordinate(p.lat, p.lng) &&
    p.label.trim().length > 0 &&
    p.label.trim().length <= 500
  )
}
export function endpointLocation(
  route: Route | undefined,
  which: 'origin' | 'destination',
): SelectedLocation | null {
  if (!route) return null
  const lat =
    which === 'origin'
      ? (route.origin_lat ?? route.origin_latitude)
      : (route.destination_lat ?? route.destination_latitude)
  const lng =
    which === 'origin'
      ? (route.origin_lng ?? route.origin_longitude)
      : (route.destination_lng ?? route.destination_longitude)
  return validCoordinate(lat, lng)
    ? { label: route[which], lat: Number(lat), lng: Number(lng), source: 'map' }
    : null
}
export function matchingRoute(
  routes: Route[],
  origin: SelectedLocation | null,
  destination: SelectedLocation | null,
) {
  if (!validLocation(origin) || !validLocation(destination)) return undefined
  return routes
    .map((route) => {
      const a = endpointLocation(route, 'origin'),
        b = endpointLocation(route, 'destination')
      const first = a ? distanceKm([a.lat, a.lng], [origin.lat, origin.lng]) : Infinity
      const last = b ? distanceKm([b.lat, b.lng], [destination.lat, destination.lng]) : Infinity
      return { route, first, last }
    })
    .filter(
      ({ route, first, last }) =>
        placeKey(route.origin) === placeKey(origin.label) &&
        placeKey(route.destination) === placeKey(destination.label) &&
        first <= 0.05 &&
        last <= 0.05,
    )
    .sort(
      (a, b) => a.first + a.last - (b.first + b.last) || a.route.id.localeCompare(b.route.id),
    )[0]?.route
}
