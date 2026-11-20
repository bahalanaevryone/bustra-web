import type { PickupPoint, Route } from '../../types'
export const placeKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
export const generatedRouteName = (origin: string, destination: string) =>
  `${origin.trim().replace(/\s+/g, ' ')} → ${destination.trim().replace(/\s+/g, ' ')}`
export function registeredPlaces(routes: Route[], points: PickupPoint[]) {
  const places = new Map<string, string>()
  for (const name of [
    ...routes.flatMap((r) => [r.origin, r.destination]),
    ...points.filter((p) => p.is_active).map((p) => p.name),
  ]) {
    if (placeKey(name)) places.set(placeKey(name), name.trim().replace(/\s+/g, ' '))
  }
  return [...places.values()].sort((a, b) => a.localeCompare(b))
}
