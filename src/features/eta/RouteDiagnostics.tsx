import { useEffect, useState } from 'react'
import type { Operations } from '../../hooks/useOperations'
import type { BusLocation } from '../../types'
import type { Coordinate } from '../map/routeGeometry'
import type { RouteDiagnostics as Diagnostics } from '../../../supabase/functions/_shared/eta'
import { requireClient } from '../../lib/supabase/client'
import { errorMessage, locationAge } from '../../lib/utils'
import { Notice } from '../../components/ui'
import { PickupMap } from '../pickups/PickupMap'
import '../../styles/schedule.css'

interface Check {
  status: string
  message: string
  route_source?: string
  route_path?: Coordinate[]
  diagnostics?: Diagnostics
  location?: BusLocation | null
}
export function RouteDiagnostics({
  data,
  initialTrip,
  onReview,
}: {
  data: Operations
  initialTrip?: string
  onReview?: (id: string) => void
}) {
  const [selection, setSelection] = useState(initialTrip ?? '')
  const trip =
    data.trips.find((t) => t.id === selection) ??
    data.trips.find((t) => t.status === 'active') ??
    data.trips[0]
  const route = data.routes.find((r) => r.id === trip?.route_id)
  const [pin, setPin] = useState<Coordinate | null>(null)
  const [requestId, setRequestId] = useState('')
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<{ key: string; check?: Check; error?: string }>({ key: '' })
  const [busy, setBusy] = useState(false)
  const key = JSON.stringify([trip?.id, pin])
  useEffect(() => {
    setPin(null)
    setRequestId('')
  }, [trip?.id])
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }, 30000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!trip) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      void requireClient()
        .functions.invoke<Check>('predict-eta', {
          body: {
            action: 'diagnose',
            trip_id: trip.id,
            ...(pin ? { pickup_latitude: pin[0], pickup_longitude: pin[1] } : {}),
          },
          signal: controller.signal,
        })
        .then(({ data, error }) => {
          if (error || !data?.status)
            throw new Error(
              'Route diagnostics are unavailable. Check the connection and Edge Function deployment.',
            )
          if (!controller.signal.aborted) setState({ key, check: data })
        })
        .catch((e) => {
          if (!controller.signal.aborted) setState({ key, error: errorMessage(e) })
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, tick])
  const check = state.key === key ? state.check : undefined
  const requests = data.pickup_requests.filter(
    (q) => q.trip_id === trip?.id && ['pending', 'accepted'].includes(q.status),
  )
  return (
    <section className="card eta-admin-panel" aria-label="Route and GPS diagnostics">
      <div className="card-heading">
        <h2>Route and GPS diagnostics</h2>
        <button
          className="button button-outline button-small"
          disabled={busy || !trip}
          onClick={() => setTick((t) => t + 1)}
        >
          {busy ? 'Checking...' : 'Refresh route check'}
        </button>
      </div>
      <div className="eta-admin-content">
        <p>
          Compare the assigned road path, reported bus GPS and pickup pin on one map. The 150 m
          corridor remains enforced.
        </p>
        <label className="field">
          <span>Trip to diagnose</span>
          <select value={trip?.id ?? ''} onChange={(e) => setSelection(e.target.value)}>
            <option value="">Select a trip</option>
            {data.trips.map((t) => (
              <option key={t.id} value={t.id}>
                {data.buses.find((b) => b.id === t.bus_id)?.plate_number} ·{' '}
                {data.routes.find((r) => r.id === t.route_id)?.route_name} · {t.status}
              </option>
            ))}
          </select>
        </label>
        {!trip ? (
          <Notice>
            No schedules are available. Create and assign a real trip before collecting
            observations.
          </Notice>
        ) : (
          <>
            {requests.length > 0 && (
              <label className="field">
                <span>Assigned passenger pickup</span>
                <select
                  value={requestId}
                  onChange={(e) => {
                    setRequestId(e.target.value)
                    const request = requests.find((q) => q.id === e.target.value)
                    setPin(
                      request
                        ? [Number(request.pickup_latitude), Number(request.pickup_longitude)]
                        : null,
                    )
                  }}
                >
                  <option value="">Use a temporary diagnostic pin</option>
                  {requests.map((q, i) => (
                    <option key={q.id} value={q.id}>
                      Pickup {i + 1} · {q.status}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="form-help">
              Blue: bus GPS · A/B: assigned endpoints · P: selected pickup. Click the map to inspect
              a temporary pin; this does not change a passenger request or saved route. Existing
              pickup positions remain restricted to their owner and assigned driver.
            </p>
            {state.key === key && state.error && <Notice tone="error">{state.error}</Notice>}
            {check && (
              <Notice
                tone={['ready', 'ok', 'near_pickup'].includes(check.status) ? 'info' : 'error'}
              >
                {check.message}
              </Notice>
            )}
            <PickupMap
              key={trip.id}
              route={route}
              roadPath={check?.route_path}
              location={check?.location}
              pin={pin}
              onPlace={(p) => {
                setRequestId('')
                setPin(p)
              }}
              disabled={false}
              label="Route and GPS diagnostic map"
            />
            <dl className="eta-diagnostics-grid">
              <div>
                <dt>Road path source</dt>
                <dd>{check?.route_source?.replaceAll('_', ' ') ?? 'Waiting for route check'}</dd>
              </div>
              <div>
                <dt>Bus distance from route</dt>
                <dd>{check?.diagnostics?.bus_offset_m ?? 'Unknown'} m</dd>
              </div>
              <div>
                <dt>Pickup distance from route</dt>
                <dd>
                  {check?.diagnostics?.pickup_offset_m ?? 'Choose a pin'}
                  {check?.diagnostics?.pickup_offset_m != null ? ' m' : ''}
                </dd>
              </div>
              <div>
                <dt>GPS accuracy</dt>
                <dd>{check?.location?.accuracy_m ?? 'Unknown'} m</dd>
              </div>
              <div>
                <dt>Last GPS report</dt>
                <dd>{locationAge(check?.location?.updated_at)}</dd>
              </div>
              <div>
                <dt>GPS speed / direction</dt>
                <dd>
                  {check?.location?.speed_kmh ?? 'Unknown'} km/h ·{' '}
                  {check?.location?.course_degrees == null
                    ? 'Direction unconfirmed'
                    : `${Math.round(check.location.course_degrees)}°`}
                </dd>
              </div>
              <div>
                <dt>Assigned origin (lat, lng)</dt>
                <dd>
                  {route?.origin_lat}, {route?.origin_lng}
                </dd>
              </div>
              <div>
                <dt>Assigned destination (lat, lng)</dt>
                <dd>
                  {route?.destination_lat}, {route?.destination_lng}
                </dd>
              </div>
              <div>
                <dt>Reported bus (lat, lng)</dt>
                <dd>
                  {check?.location
                    ? `${check.location.latitude}, ${check.location.longitude}`
                    : 'No GPS'}
                </dd>
              </div>
              <div>
                <dt>Selected pickup (lat, lng)</dt>
                <dd>{pin ? `${pin[0].toFixed(6)}, ${pin[1].toFixed(6)}` : 'No pin selected'}</dd>
              </div>
            </dl>
            {!route?.road_path && (
              <Notice>
                No stored road path exists. The router suggests roads between the endpoints; the
                operator must verify these are the actual roads used by the bus.
              </Notice>
            )}
            {onReview && route && (
              <button className="button button-outline" onClick={() => onReview(route.id)}>
                Review assigned road path
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
