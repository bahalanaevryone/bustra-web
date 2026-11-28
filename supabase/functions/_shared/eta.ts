// Shared by the Edge Function and deterministic unit tests. Coordinates are [lat, lng].
export type Point = [number, number]
export class EtaUnavailable extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export interface Fix {
  latitude: number
  longitude: number
  updated_at: string
  accuracy_m: number | null
  speed_kmh: number | null
  course_degrees?: number | null
}
export interface EtaResult {
  status: string
  message: string
  minutes: number | null
  road_distance_m: number | null
  location_updated_at: string | null
  source: 'approximate' | 'ai'
  movement?: string
  model_version?: string
  routing_minutes?: number
}
export function validPoint(p: unknown): p is Point {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(p[0]) <= 90 &&
    Math.abs(p[1]) <= 180
  )
}
export function metres(a: Point, b: Point) {
  const r = Math.PI / 180
  const h =
    Math.sin(((b[0] - a[0]) * r) / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)))
}
export function bearing(a: Point, b: Point) {
  const r = Math.PI / 180,
    dl = (b[1] - a[1]) * r
  return (
    (Math.atan2(
      Math.sin(dl) * Math.cos(b[0] * r),
      Math.cos(a[0] * r) * Math.sin(b[0] * r) -
        Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos(dl),
    ) /
      r +
      360) %
    360
  )
}
// Projection determines ordering/proximity only. ETA distance always comes from the router.
export function project(point: Point, path: Point[]) {
  let cumulative = 0
  const candidates: { distance: number; progress: number; segment: number; point: Point }[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i],
      b = path[i + 1],
      scale = Math.cos((point[0] * Math.PI) / 180)
    const dx = (b[1] - a[1]) * scale,
      dy = b[0] - a[0],
      len = dx * dx + dy * dy
    const t = len
      ? Math.max(0, Math.min(1, ((point[1] - a[1]) * scale * dx + (point[0] - a[0]) * dy) / len))
      : 0
    const p: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    const length = metres(a, b)
    candidates.push({
      distance: metres(point, p),
      progress: cumulative + t * length,
      segment: i,
      point: p,
    })
    cumulative += length
  }
  candidates.sort((a, b) => a.distance - b.distance)
  const best = candidates[0]
  if (!best) throw new EtaUnavailable('route_unavailable', 'No usable assigned road path.')
  if (
    candidates.some(
      (c) => c.distance <= best.distance + 20 && Math.abs(c.progress - best.progress) > 300,
    )
  )
    throw new EtaUnavailable(
      'ambiguous_route',
      'This loop or overlapping route needs a verified travel direction.',
    )
  return best
}
export function checkFix(fix: Fix | null, now = Date.now()) {
  if (!fix || !validPoint([fix.latitude, fix.longitude]))
    throw new EtaUnavailable('gps_missing', 'Waiting for bus GPS coordinates.')
  const age = now - Date.parse(fix.updated_at)
  if (!Number.isFinite(age) || age > 90000 || age < -10000)
    throw new EtaUnavailable(
      'gps_stale',
      'The bus location is outdated. Waiting for a fresh report.',
    )
  if (
    fix.accuracy_m == null ||
    !Number.isFinite(fix.accuracy_m) ||
    fix.accuracy_m < 0 ||
    fix.accuracy_m > 100
  )
    throw new EtaUnavailable(
      'gps_inaccurate',
      'Bus GPS accuracy is unavailable or worse than 100 metres.',
    )
}
export function approach(fix: Fix, pickup: Point, path: Point[]) {
  const bus = project([fix.latitude, fix.longitude], path),
    target = project(pickup, path)
  if (bus.distance > 150 || target.distance > 150)
    throw new EtaUnavailable(
      'off_route',
      'The bus or pickup pin is too far from the assigned road path. Move the pin closer or wait for the bus.',
    )
  if (
    metres([fix.latitude, fix.longitude], pickup) <= 50 &&
    fix.accuracy_m != null &&
    fix.accuracy_m <= 25
  )
    return { bus, target, movement: 'near_pickup' }
  if (target.progress < bus.progress - 60)
    throw new EtaUnavailable(
      'passed',
      'The bus has already passed this pickup location along its assigned route.',
    )
  if (fix.speed_kmh != null && fix.speed_kmh < 2) return { bus, target, movement: 'stopped' }
  if (fix.course_degrees == null || !Number.isFinite(fix.course_degrees))
    throw new EtaUnavailable(
      'direction_unknown',
      'Waiting for enough GPS movement to confirm the bus is approaching.',
    )
  const tangent = bearing(path[bus.segment], path[bus.segment + 1])
  const diff = Math.abs(((fix.course_degrees - tangent + 540) % 360) - 180)
  if (diff > 100)
    throw new EtaUnavailable('moving_away', 'The bus is moving away along its assigned route.')
  if (diff > 70)
    throw new EtaUnavailable(
      'direction_unknown',
      'Bus direction is unclear. Waiting for another GPS report.',
    )
  return { bus, target, movement: 'approaching' }
}
export interface RoadResult {
  coordinates: Point[]
  distance: number
  duration: number
}
export async function roadRoute(
  base: string,
  points: Point[],
  fetcher: typeof fetch = fetch,
): Promise<RoadResult> {
  if (!base) throw new EtaUnavailable('routing_unavailable', 'Road routing is not configured.')
  if (points.length < 2 || points.length > 25 || !points.every(validPoint))
    throw new EtaUnavailable('route_unavailable', 'Invalid route coordinates.')
  const url = new URL(
    base.replace(/\/$/, '') + '/route/v1/driving/' + points.map((p) => `${p[1]},${p[0]}`).join(';'),
  )
  url.search = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    alternatives: 'false',
    steps: 'false',
    radiuses: points.map(() => '150').join(';'),
  }).toString()
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('Router HTTP error')
    const data = await response.json(),
      route = data.routes?.[0]
    const coordinates: Point[] =
      route?.geometry?.coordinates?.map((p: number[]) => [p[1], p[0]]) ?? []
    if (
      data.code !== 'Ok' ||
      coordinates.length < 2 ||
      !coordinates.every(validPoint) ||
      !Number.isFinite(route?.distance) ||
      route.distance < 0 ||
      !Number.isFinite(route?.duration) ||
      route.duration < 0 ||
      route.duration > 43200
    )
      throw new EtaUnavailable('no_route', 'No valid driving route was found.')
    if (
      metres(coordinates[0], points[0]) > 150 ||
      metres(coordinates.at(-1)!, points.at(-1)!) > 150
    )
      throw new EtaUnavailable('no_route', 'The router could not reach the chosen coordinates.')
    return { coordinates, distance: route.distance, duration: route.duration }
  } catch (e) {
    if (e instanceof EtaUnavailable) throw e
    throw new EtaUnavailable(
      'routing_unavailable',
      'Road routing failed or timed out. Try again shortly.',
    )
  }
}
export const FEATURES = [
  'road_distance_km',
  'speed_kmh',
  'speed_missing',
  'hour_sin',
  'hour_cos',
  'weekday',
] as const
export async function estimate(
  fix: Fix,
  pickup: Point,
  path: Point[],
  router: (p: Point[]) => Promise<RoadResult>,
  model: unknown = null,
  now = Date.now(),
): Promise<EtaResult> {
  checkFix(fix, now)
  const { bus, target, movement } = approach(fix, pickup, path)
  if (movement === 'near_pickup')
    return {
      status: 'near_pickup',
      message: 'Bus is near the pickup pin. Arrival is being verified by successive GPS reports.',
      minutes: null,
      road_distance_m: null,
      source: 'approximate',
      location_updated_at: fix.updated_at,
      movement,
    }
  if (target.progress <= bus.progress)
    throw new EtaUnavailable(
      'passed',
      'The pickup point is behind the bus on its assigned road path.',
    )
  const middle = path.slice(bus.segment + 1, target.segment + 1)
  const waypoints: Point[] = [[fix.latitude, fix.longitude]]
  for (let i = 0; i < middle.length; i += Math.max(1, Math.ceil(middle.length / 22)))
    waypoints.push(middle[i])
  waypoints.push(pickup)
  const road = await router(waypoints)
  // Refuse a router shortcut/diversion that departs from the assigned road corridor.
  const expected = target.progress - bus.progress
  if (
    road.distance < expected * 0.75 ||
    road.distance > expected * 1.5 + 300 ||
    road.coordinates.some((p) => project(p, path).distance > 150)
  )
    throw new EtaUnavailable(
      'route_mismatch',
      'The driving route does not follow this bus route. ETA is unavailable.',
    )
  const ai =
    movement === 'stopped'
      ? null
      : modelPrediction(model, features(road.distance, fix.speed_kmh, fix.updated_at))
  return {
    status: 'ok',
    minutes: ai?.minutes ?? road.duration / 60,
    routing_minutes: road.duration / 60,
    road_distance_m: road.distance,
    source: ai ? 'ai' : 'approximate',
    location_updated_at: fix.updated_at,
    movement,
    message:
      movement === 'stopped'
        ? 'Bus is stopped. Travel time excludes the unknown waiting time.'
        : 'Travel estimate; traffic and boarding delays may change it.',
    ...(ai ? { model_version: ai.version } : {}),
  }
}
export function features(distance: number, speed: number | null, observed: string) {
  const date = new Date(Date.parse(observed) + 8 * 3600000),
    hour = date.getUTCHours() + date.getUTCMinutes() / 60
  return [
    distance / 1000,
    speed ?? 0,
    speed == null ? 1 : 0,
    Math.sin((hour * Math.PI) / 12),
    Math.cos((hour * Math.PI) / 12),
    (date.getUTCDay() + 6) % 7,
  ]
}
export function modelPrediction(
  model: unknown,
  x: number[],
): { minutes: number; version: string } | null {
  if (!model || typeof model !== 'object') return null
  const m = model as Record<string, any>
  if (
    m.schema_version !== 1 ||
    m.algorithm !== 'LinearRegression' ||
    m.eligible !== true ||
    !m.version ||
    JSON.stringify(m.features) !== JSON.stringify(FEATURES) ||
    m.timezone !== 'Asia/Manila'
  )
    return null
  if (!(
    m.metrics?.holdout_trips >= 6 &&
    m.metrics?.training_trips >= 20 &&
    m.metrics?.model_mae_minutes >= 0 &&
    m.metrics?.model_mae_minutes < m.metrics?.routing_mae_minutes
  ))
    return null
  if (
    ![m.coefficients, m.mean, m.scale, m.minimum, m.maximum].every(
      (a) => Array.isArray(a) && a.length === x.length && a.every(Number.isFinite),
    ) ||
    !Number.isFinite(m.intercept)
  )
    return null
  if (
    x.some(
      (v, i) =>
        !Number.isFinite(v) ||
        m.scale[i] <= 0 ||
        v < m.minimum[i] - 1e-9 ||
        v > m.maximum[i] + 1e-9,
    )
  )
    return null
  const minutes =
    m.intercept +
    x.reduce((sum, v, i) => sum + ((v - m.mean[i]) / m.scale[i]) * m.coefficients[i], 0)
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 720
    ? { minutes, version: m.version }
    : null
}
