import { createClient } from 'npm:@supabase/supabase-js@2.99.0'
import {
  assignedRoadPath,
  checkFix,
  estimate,
  EtaUnavailable,
  roadRoute,
  routeDiagnostics,
  validPoint,
} from '../_shared/eta.ts'
import type { EtaResult, Fix, Point } from '../_shared/eta.ts'
import { modelStatus, TRAINING_REQUIREMENTS } from '../_shared/model-status.ts'
import model from './model.json' with { type: 'json' }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const routerUrl = Deno.env.get('ETA_ROUTING_URL')?.trim() ?? ''
const paths = new Map<
  string,
  { expires: number; value: Promise<Awaited<ReturnType<typeof assignedRoadPath>>> }
>()
const estimates = new Map<string, { expires: number; value: Promise<EtaResult> }>()
function cached<T>(
  map: Map<string, { expires: number; value: Promise<T> }>,
  key: string,
  ttl: number,
  run: () => Promise<T>,
) {
  const old = map.get(key)
  if (old && old.expires > Date.now()) return old.value
  for (const [k, v] of map) if (v.expires < Date.now()) map.delete(k)
  if (map.size >= 200) map.delete(map.keys().next().value!)
  const value = run()
  map.set(key, { expires: Date.now() + ttl, value })
  void value.catch(() => map.delete(key))
  return value
}
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })
const unavailable = (e: EtaUnavailable, fix: Fix | null): EtaResult => ({
  status: e.code,
  message: e.message,
  minutes: null,
  road_distance_m: null,
  source: 'approximate',
  location_updated_at: fix?.updated_at ?? null,
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  try {
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
    if (Number(req.headers.get('content-length') ?? 0) > 2048)
      return reply({ error: 'Request too large.' }, 413)
    const raw = await req.text()
    if (raw.length > 2048) return reply({ error: 'Request too large.' }, 413)
    let body: Record<string, any>
    try {
      body = JSON.parse(raw)
    } catch {
      return reply({ error: 'Invalid JSON.' }, 400)
    }
    if (!body || typeof body !== 'object') return reply({ error: 'Invalid request.' }, 400)
    if (body.action === 'status') {
      const { data, error } = await client.rpc('eta_ai_status')
      if (error) return reply({ error: 'Active administrator access required.' }, 403)
      return reply({ ...data, model: modelStatus(model), requirements: TRAINING_REQUIREMENTS })
    }
    if (typeof body.trip_id !== 'string' || !uuid.test(body.trip_id))
      return reply({ error: 'Choose a valid trip.' }, 400)
    const diagnose = body.action === 'diagnose',
      collect = body.collect === true
    const pickup: Point | null =
      body.pickup_latitude == null && body.pickup_longitude == null
        ? null
        : [body.pickup_latitude, body.pickup_longitude]
    if ((!collect && !diagnose && !validPoint(pickup)) || (pickup !== null && !validPoint(pickup)))
      return reply({ error: 'Choose valid pickup coordinates, in latitude/longitude order.' }, 400)
    if (collect) {
      const { data: trip, error } = await client
        .from('trips')
        .select('id,driver_id,status')
        .eq('id', body.trip_id)
        .maybeSingle()
      if (error || !trip || trip.driver_id !== user.id || trip.status !== 'active')
        return reply({ error: 'Only the assigned driver can collect trip observations.' }, 403)
    }
    const { data: context, error: contextError } = await client.rpc(
      diagnose ? 'eta_diagnostic_context' : 'eta_context',
      { p_trip: body.trip_id },
    )
    if (contextError)
      return reply(
        {
          error: diagnose
            ? 'Assigned employee or administrator access required.'
            : 'Unable to load ETA context.',
        },
        diagnose ? 403 : 503,
      )
    if (!context)
      return reply(
        unavailable(new EtaUnavailable('trip_unavailable', 'This trip is no longer active.'), null),
      )
    const fix = context.location as Fix | null,
      route = context.route,
      routeKey = JSON.stringify(route)
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    type Target = { id?: string; pin: Point }
    let targets: Target[] = []
    if (!diagnose) {
      if (collect) {
        const { data, error } = await client.rpc('eta_collection_targets', { p_trip: body.trip_id })
        if (error) throw new Error('Unable to load collection targets')
        targets = (data ?? []).map(
          (q: { id: string; pickup_latitude: number; pickup_longitude: number }) => ({
            id: q.id,
            pin: [Number(q.pickup_latitude), Number(q.pickup_longitude)] as Point,
          }),
        )
      } else {
        const { data, error } = await client
          .from('pickup_requests')
          .select('id')
          .eq('trip_id', body.trip_id)
          .eq('user_id', user.id)
          .in('status', ['pending', 'accepted'])
          .gte('pickup_latitude', pickup![0] - 0.000001)
          .lte('pickup_latitude', pickup![0] + 0.000001)
          .gte('pickup_longitude', pickup![1] - 0.000001)
          .lte('pickup_longitude', pickup![1] + 0.000001)
          .limit(1)
        if (error) throw new Error('Unable to load pickup request')
        targets = [{ id: data?.[0]?.id, pin: pickup! }]
      }
    }
    let recorded = 0,
      rejected = 0,
      throttled = 0
    const reasons: Record<string, number> = {}
    async function reject(target: Target, code: string) {
      reasons[code] = (reasons[code] ?? 0) + 1
      if (!target.id) return
      const { data, error } = await admin.rpc('record_eta_rejection', {
        p_request: target.id,
        p_observed: fix?.updated_at ?? null,
        p_reason: code,
      })
      if (error) throw new Error('Diagnostic write failed')
      if (data?.status === 'rejected') rejected++
      else throttled++
    }
    async function note(status = 'ok') {
      if (!collect) return
      const allowed = [
        'ok',
        'no_open_requests',
        'gps_missing',
        'gps_stale',
        'gps_inaccurate',
        'routing_unavailable',
        'route_unavailable',
        'route_endpoints_mismatch',
      ]
      const { error } = await admin.rpc('eta_note_collection', {
        p_trip: body.trip_id,
        p_status: allowed.includes(status) ? status : 'failed',
        p_attempted: targets.length,
        p_recorded: recorded,
        p_rejected: rejected,
      })
      if (error) throw new Error('Collection summary write failed')
    }
    if (collect && !targets.length) {
      await note('no_open_requests')
      return reply({
        status: 'ok',
        processed: 0,
        rejected: 0,
        reason: 'no_open_requests',
        message: 'No confirmed pending or accepted pickup requests for this trip.',
      })
    }
    if (!diagnose) {
      try {
        checkFix(fix)
      } catch (e) {
        if (!(e instanceof EtaUnavailable)) throw e
        for (const target of targets) await reject(target, e.code)
        await note(e.code)
        return reply({
          ...unavailable(e, fix),
          collection: collect ? { recorded, rejected, reasons } : undefined,
        })
      }
    }
    let geometry: Awaited<ReturnType<typeof assignedRoadPath>>
    try {
      geometry = await cached(paths, routeKey, 300000, () =>
        assignedRoadPath(route, (p) => roadRoute(routerUrl, p)),
      )
    } catch (e) {
      if (!(e instanceof EtaUnavailable)) throw e
      for (const target of targets) await reject(target, e.code)
      await note(e.code)
      return reply({
        ...unavailable(e, fix),
        collection: collect ? { recorded, rejected, reasons } : undefined,
      })
    }
    const { path, source } = geometry
    const diagnostics = (pin: Point | null) =>
      routeDiagnostics(
        fix,
        pin,
        path,
        [route.origin_lat, route.origin_lng],
        [route.destination_lat, route.destination_lng],
      )
    if (diagnose) {
      let status = 'ready',
        message =
          'Compare the road path, bus GPS and pickup pin. Review suggested roads with the operator.'
      try {
        checkFix(fix)
        if (pickup) await estimate(fix!, pickup, path, (p) => roadRoute(routerUrl, p), null)
        else if (diagnostics(null).bus_offset_m! > 150)
          throw new EtaUnavailable(
            'bus_off_route',
            `Bus GPS is ${diagnostics(null).bus_offset_m} m from this path. Verify the device GPS and actual roads used before reviewing the route.`,
          )
      } catch (e) {
        if (!(e instanceof EtaUnavailable)) throw e
        status = e.code
        message = e.message
      }
      return reply({
        status,
        message,
        route_path: path,
        route_source: source,
        diagnostics: diagnostics(pickup),
        location: fix,
        route,
        model: modelStatus(model),
      })
    }
    let last: EtaResult | undefined
    // Bound each collection invocation to eight targets. The SQL selector rotates by last attempt.
    // Process in pairs to avoid long serial batches and unbounded provider requests.
    async function process(target: Target) {
      let result: EtaResult
      try {
        result = await cached(
          estimates,
          JSON.stringify([body.trip_id, routeKey, fix?.updated_at, target.pin]),
          15000,
          () => estimate(fix!, target.pin, path, (p) => roadRoute(routerUrl, p), model),
        )
      } catch (e) {
        if (!(e instanceof EtaUnavailable)) throw e
        result = unavailable(e, fix)
      }
      result = { ...result, diagnostics: diagnostics(target.pin), route_path: path }
      if (target.id) {
        if (result.status === 'ok') {
          const { data, error } = await admin.rpc('record_eta_sample', {
            p_request: target.id,
            p_observed: fix!.updated_at,
            p_distance: result.road_distance_m,
            p_minutes: result.routing_minutes,
          })
          if (error) throw new Error('Training sample write failed')
          if (data?.status === 'recorded') recorded++
          else if (data?.status === 'throttled') throttled++
          else if (data?.reason) await reject(target, data.reason)
        } else await reject(target, result.status)
      }
      last = result
    }
    for (let i = 0; i < targets.length; i += 2)
      await Promise.all(targets.slice(i, i + 2).map(process))
    await note()
    return collect
      ? reply({
          status: 'ok',
          processed: recorded,
          rejected,
          throttled,
          attempted: targets.length,
          reasons,
        })
      : reply(last)
  } catch {
    console.error(
      'ETA request failed; see collection diagnostics. No passenger coordinates logged.',
    )
    return reply(
      { error: 'ETA service unavailable. Retry shortly and check the employee collection status.' },
      503,
    )
  }
})
