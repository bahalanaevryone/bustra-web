import type { Coordinate } from './routeGeometry'
import { distanceKm, validCoordinate } from './routeGeometry'
export interface RoadRoute {
  coordinates: Coordinate[]
  distanceMetres: number
  durationSeconds: number
}
const cache = new Map<string, Promise<RoadRoute>>()
let queue: Promise<unknown> = Promise.resolve()
let lastRequest = 0
export function routingConfigured() {
  return !!import.meta.env.VITE_ROUTING_URL?.trim()
}
export function requestRoadRoute(coordinates: Coordinate[]): Promise<RoadRoute> {
  const base = import.meta.env.VITE_ROUTING_URL?.trim()
  if (!base)
    return Promise.reject(
      new Error('Road routing is not configured. Only the stop guide is available.'),
    )
  const key = base + JSON.stringify(coordinates)
  const previous = cache.get(key)
  if (previous) return previous
  if (
    coordinates.length < 2 ||
    coordinates.length > 25 ||
    coordinates.some((p) => !validCoordinate(p[0], p[1]))
  )
    return Promise.reject(new Error('Choose between 2 and 25 correctly ordered route points.'))
  // Queue community routing requests at less than one per second; cache for this tab.
  const task = queue
    .catch(() => undefined)
    .then(async () => {
      const delay = Math.max(0, 1100 - (Date.now() - lastRequest))
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      lastRequest = Date.now()
      const url = new URL(
        base.replace(/\/$/, '') +
          '/route/v1/driving/' +
          coordinates.map(([lat, lng]) => `${lng},${lat}`).join(';'),
      )
      url.search = new URLSearchParams({
        overview: 'full',
        geometries: 'geojson',
        alternatives: 'false',
        steps: 'false',
        generate_hints: 'false',
        radiuses: coordinates.map(() => '500').join(';'),
      }).toString()
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) })
      if (!response.ok)
        throw new Error('Road routing is unavailable. The dashed stop guide is still shown.')
      const data = await response.json(),
        route = data.routes?.[0]
      if (
        data.code !== 'Ok' ||
        !Array.isArray(route?.geometry?.coordinates) ||
        route.geometry.coordinates.length < 2
      )
        throw new Error('No road route was found through these pickup points.')
      const path: Coordinate[] = route.geometry.coordinates.map(([lng, lat]: number[]) => [
        lat,
        lng,
      ])
      if (
        path.some((p) => !validCoordinate(p[0], p[1])) ||
        distanceKm(path[0], coordinates[0]) > 1 ||
        distanceKm(path[path.length - 1], coordinates[coordinates.length - 1]) > 1
      )
        throw new Error('The routing result does not match the selected stops.')
      return {
        coordinates: path,
        distanceMetres: route.distance,
        durationSeconds: route.duration,
      } as RoadRoute
    })
  queue = task
  cache.set(key, task)
  void task.catch(() => cache.delete(key))
  return task
}
