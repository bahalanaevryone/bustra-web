import { createClient } from 'npm:@supabase/supabase-js@2.99.0'
import { checkFix, estimate, EtaUnavailable, roadRoute, validPoint } from '../_shared/eta.ts'
import type { Fix, Point } from '../_shared/eta.ts'
import model from './model.json' with { type: 'json' }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const routerUrl = Deno.env.get('ETA_ROUTING_URL')?.trim() ?? ''
// Bounded warm-isolate caches reduce duplicate route work. Correctness never relies on a warm isolate.
const paths = new Map<string, { expires: number; value: Promise<Point[]> }>()
const estimates = new Map<
  string,
  { expires: number; value: Promise<Awaited<ReturnType<typeof estimate>>> }
>()
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })
}
function cache<T>(
  map: Map<string, { expires: number; value: Promise<T> }>,
  key: string,
  ttl: number,
  create: () => Promise<T>,
): Promise<T> {
  const found = map.get(key)
  if (found && found.expires > Date.now()) return found.value
  for (const [k, v] of map) if (v.expires <= Date.now()) map.delete(k)
  if (map.size >= 200) map.delete(map.keys().next().value!)
  const value = create()
  map.set(key, { value, expires: Date.now() + ttl })
  void value.catch(() => map.delete(key))
  return value
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Sign in to get an ETA.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!,
    key = Deno.env.get('SUPABASE_ANON_KEY')!
  const client = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser()
  if (authError || !user) return reply({ error: 'Your session expired. Sign in again.' }, 401)
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 2048)
      return reply({ error: 'Request too large.' }, 413)
    const raw = await req.text()
    if (raw.length > 2048) return reply({ error: 'Request too large.' }, 413)
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return reply({ error: 'Invalid JSON.' }, 400)
    }
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.trip_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.trip_id,
      )
    )
      return reply({ error: 'Choose a valid trip.' }, 400)
    const pickup: Point = [body.pickup_latitude, body.pickup_longitude]
    if (body.collect !== true && !validPoint(pickup))
      return reply({ error: 'Choose valid pickup coordinates.' }, 400)
    if (body.collect === true) {
      const { data: trip, error } = await client
        .from('trips')
        .select('id,driver_id,status')
        .eq('id', body.trip_id)
        .maybeSingle()
      if (error || !trip || trip.driver_id !== user.id || trip.status !== 'active')
        return reply({ error: 'Only the assigned driver can collect trip observations.' }, 403)
    }
    const { data: context, error } = await client.rpc('eta_context', { p_trip: body.trip_id })
    if (error) throw new Error('context')
    if (!context)
      return reply({
        status: 'trip_unavailable',
        message: 'This trip is no longer active.',
        minutes: null,
        road_distance_m: null,
        source: 'approximate',
        location_updated_at: null,
      })
    const fix = context.location as Fix | null
    try {
      checkFix(fix)
    } catch (e) {
      if (e instanceof EtaUnavailable)
        return reply({
          status: e.code,
          message: e.message,
          minutes: null,
          road_distance_m: null,
          source: 'approximate',
          location_updated_at: fix?.updated_at ?? null,
        })
      throw e
    }
    const route = context.route
    const routeKey = JSON.stringify(route)
    const path = await cache(paths, routeKey, 300000, async () => {
      if (
        Array.isArray(route.road_path) &&
        route.road_path.length >= 2 &&
        route.road_path.every(validPoint)
      )
        return route.road_path as Point[]
      const origin: Point = [route.origin_lat, route.origin_lng],
        destination: Point = [route.destination_lat, route.destination_lng]
      if (!validPoint(origin) || !validPoint(destination))
        throw new EtaUnavailable(
          'route_unavailable',
          'The assigned route has no usable road path or endpoints.',
        )
      return (await roadRoute(routerUrl, [origin, destination])).coordinates
    })
    // RLS: passenger sees own requests; assigned driver sees requests for this trip.
    let query = client
      .from('pickup_requests')
      .select('id,pickup_latitude,pickup_longitude,requested_at')
      .eq('trip_id', body.trip_id)
      .in('status', ['pending', 'accepted'])
      .order('requested_at', { ascending: true })
      .limit(20)
    if (body.collect !== true)
      query = query
        .eq('user_id', user.id)
        .gte('pickup_latitude', pickup[0] - 0.000001)
        .lte('pickup_latitude', pickup[0] + 0.000001)
        .gte('pickup_longitude', pickup[1] - 0.000001)
        .lte('pickup_longitude', pickup[1] + 0.000001)
    const { data: requests, error: requestError } = await query
    if (requestError) throw new Error('requests')
    const targets =
      body.collect === true
        ? (requests ?? []).map((q) => ({
            pin: [Number(q.pickup_latitude), Number(q.pickup_longitude)] as Point,
            request: q,
          }))
        : [{ pin: pickup, request: requests?.[0] }]
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    let result,
      collected = 0
    for (const target of targets) {
      try {
        result = await cache(
          estimates,
          JSON.stringify([body.trip_id, routeKey, fix!.updated_at, target.pin]),
          15000,
          () => estimate(fix!, target.pin, path, (p) => roadRoute(routerUrl, p), model),
        )
        if (target.request && result.status === 'ok') {
          // Record the routing baseline, even when the response uses AI.
          const { error: writeError } = await admin.rpc('record_eta_sample', {
            p_request: target.request.id,
            p_observed: fix!.updated_at,
            p_distance: result.road_distance_m,
            p_minutes: result.routing_minutes,
          })
          if (writeError) console.error('ETA sample write failed', writeError.code)
          else collected++
        }
      } catch (e) {
        if (!(e instanceof EtaUnavailable)) throw e
        result = {
          status: e.code,
          message: e.message,
          minutes: null,
          road_distance_m: null,
          source: 'approximate',
          location_updated_at: fix!.updated_at,
        }
      }
    }
    return body.collect === true ? reply({ status: 'ok', processed: collected }) : reply(result)
  } catch (e) {
    if (e instanceof EtaUnavailable)
      return reply({
        status: e.code,
        message: e.message,
        minutes: null,
        road_distance_m: null,
        source: 'approximate',
        location_updated_at: null,
      })
    console.error('ETA request failed') // Never log passenger coordinates or credentials.
    return reply({ error: 'ETA service unavailable. Please try again shortly.' }, 503)
  }
})
