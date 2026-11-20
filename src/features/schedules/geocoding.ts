import { distanceKm, validCoordinate } from '../map/routeGeometry'
import type { SelectedLocation } from './scheduleRoutes'

// Photon supports interactive search. No public Nominatim endpoint is used.
const cache = new Map<string, { time: number; data: unknown }>()
let queue: Promise<unknown> = Promise.resolve()
let lastRequest = 0
let blockedUntil = 0
export function geocoderBase() {
  const base = (import.meta.env.VITE_GEOCODING_URL ?? 'https://photon.komoot.io').trim()
  if (!base) throw new Error('Address search is not configured. Choose a position on the map.')
  const url = new URL(base)
  if (url.hostname.includes('nominatim.openstreetmap.org'))
    throw new Error(
      'Configure a Photon-compatible search service. Public Nominatim autocomplete is not supported.',
    )
  return base.replace(/\/$/, '')
}
async function request(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const url = new URL(geocoderBase() + path)
  url.search = new URLSearchParams({ ...params, lang: 'en' }).toString()
  const key = url.href,
    existing = cache.get(key)
  if (existing && Date.now() - existing.time < 300000) return existing.data
  const task = queue
    .catch(() => undefined)
    .then(async () => {
      signal?.throwIfAborted()
      if (Date.now() < blockedUntil)
        throw new Error('Address search is busy. Try again in a minute or choose on the map.')
      const delay = Math.max(0, 1100 - (Date.now() - lastRequest))
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      signal?.throwIfAborted()
      lastRequest = Date.now()
      const response = await fetch(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      }).catch((error) => {
        if (signal?.aborted) throw error
        throw new Error('Address lookup is unavailable. Try again or choose a position on the map.')
      })
      if (response.status === 429) {
        blockedUntil = Date.now() + 60000
        throw new Error('Address search is busy. Try again in a minute or choose on the map.')
      }
      if (!response.ok)
        throw new Error('Address search is unavailable. Try again or choose on the map.')
      const data = await response.json()
      if (!Array.isArray(data?.features))
        throw new Error(
          'The address service returned an invalid response. Choose on the map or try again.',
        )
      if (cache.size >= 100) cache.delete(cache.keys().next().value!)
      cache.set(key, { time: Date.now(), data })
      return data
    })
  queue = task
  return task
}
export function photonLocations(data: unknown): SelectedLocation[] {
  const features = (data as { features?: unknown[] })?.features
  if (!Array.isArray(features)) return []
  const locations: SelectedLocation[] = [],
    seen = new Set<string>()
  for (const raw of features) {
    if (!raw || typeof raw !== 'object') continue
    const feature = raw as {
      geometry?: { type?: string; coordinates?: unknown[] }
      properties?: Record<string, unknown>
    }
    const c = feature.geometry?.coordinates,
      p = feature.properties
    if (
      feature.geometry?.type !== 'Point' ||
      !c ||
      typeof c[0] !== 'number' ||
      typeof c[1] !== 'number' ||
      !validCoordinate(c[1], c[0]) ||
      !p
    )
      continue
    const parts = [
      p.name,
      [p.housenumber, p.street].filter((v) => typeof v === 'string').join(' '),
      p.district,
      p.city,
      p.county,
      p.state,
      p.postcode,
      p.country,
    ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    const unique = parts.filter(
      (v, i, a) => a.findIndex((s) => s.trim().toLowerCase() === v.trim().toLowerCase()) === i,
    )
    const label = unique.join(', ')
    if (!label) continue
    const key = `${label}:${c[1]}:${c[0]}`
    if (seen.has(key)) continue
    seen.add(key)
    locations.push({ label, lat: c[1], lng: c[0], source: 'search' })
  }
  return locations
}
export async function searchLocations(query: string, signal?: AbortSignal) {
  const q = query.trim()
  if (q.length < 3) return []
  if (q.length > 500)
    throw new Error('Use a shorter address query (up to 500 characters), or choose on the map.')
  return photonLocations(
    await request(
      '/api/',
      {
        q,
        limit: '5',
        lat: String(import.meta.env.VITE_MAP_LAT || 13.2233),
        lon: String(import.meta.env.VITE_MAP_LNG || 120.596),
      },
      signal,
    ),
  )
}
export async function reverseLocation(lat: number, lng: number, signal?: AbortSignal) {
  if (!validCoordinate(lat, lng)) throw new Error('Invalid map coordinates.')
  const results = photonLocations(
    await request(
      '/reverse',
      { lat: String(lat), lon: String(lng), limit: '1', radius: '0.2' },
      signal,
    ),
  )
  return results.find((p) => distanceKm([lat, lng], [p.lat, p.lng]) <= 0.25)?.label || null
}
