import { useEffect, useState } from 'react'
import { requireClient } from '../../lib/supabase/client'
import { errorMessage, locationAge } from '../../lib/utils'
import { Notice } from '../../components/ui'

interface AiHealth {
  total_observations: number
  verified_arrivals: number
  completed_trips: number
  incomplete_observations: number
  rejected_checks: number
  rejection_reasons: Record<string, number>
  model: {
    status: string
    reason: string
    version: string | null
    metrics: {
      model_mae_minutes: number
      routing_mae_minutes: number
      training_trips: number
      holdout_trips: number
    } | null
  }
  requirements: {
    minimum_observations: number
    minimum_completed_trips: number
    minimum_training_trips: number
    minimum_holdout_trips: number
  }
  active_trips: {
    trip_id: string
    bus: string
    demo_data: boolean
    has_gps: boolean
    gps_updated_at: string | null
    gps_accuracy_m: number | null
    open_requests: number
    collection: {
      checked_at: string
      status: string
      attempted: number
      recorded: number
      rejected: number
    } | null
  }[]
}
const reasonText: Record<string, string> = {
  bus_off_route: 'Bus GPS is outside the assigned road corridor',
  pickup_off_route: 'Pickup pin is outside the assigned road corridor',
  gps_stale: 'Bus GPS is outdated',
  gps_missing: 'No bus GPS report',
  gps_inaccurate: 'GPS accuracy is insufficient for training',
  direction_unknown: 'Travel direction is not confirmed',
  moving_away: 'Bus is moving away',
  passed: 'Bus has passed the pickup',
  demo_trip: 'Demo/test vehicle excluded from real model training',
  gps_gap: 'GPS reporting gap exceeded 90 seconds',
  gps_jump: 'Physically implausible GPS movement',
  request_closed: 'Pickup was cancelled/rejected before verified arrival',
  trip_ended: 'Trip ended without verified arrival',
  near_pickup: 'Already near the pickup; waiting for verified arrival',
  location_changed: 'New GPS arrived before the routing calculation finished',
  request_newer_than_gps: 'Waiting for a GPS report after pickup confirmation',
  too_close: 'Too close to record a useful prediction observation',
  routing_unavailable: 'Routing service unavailable',
  route_unavailable: 'Assigned road path is unavailable',
  route_endpoints_mismatch: 'Saved path does not match assigned endpoints',
  ambiguous_route: 'Loop or overlapping geometry makes progress ambiguous',
}
export function AiStatus() {
  const [health, setHealth] = useState<AiHealth>()
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    void requireClient()
      .functions.invoke<AiHealth>('predict-eta', {
        body: { action: 'status' },
        signal: controller.signal,
      })
      .then(({ data, error }) => {
        if (error || !data?.model || !data.requirements)
          throw new Error('AI status is unavailable. Check the connection and backend deployment.')
        if (!controller.signal.aborted) {
          setHealth(data)
          setError('')
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh((r) => r + 1)
    }, 30000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [refresh])
  return (
    <section className="card eta-admin-panel" aria-label="Admin AI Status">
      <div className="card-heading">
        <h2>AI Status</h2>
        <button
          className="button button-outline button-small"
          disabled={busy}
          onClick={() => setRefresh((r) => r + 1)}
        >
          {busy ? 'Checking...' : 'Refresh AI status'}
        </button>
      </div>
      <div className="eta-admin-content">
        {error && <Notice tone="error">{error}</Notice>}
        {!health && !error && <p role="status">Loading verified training data...</p>}
        {health && (
          <>
            <Notice tone={health.model.status === 'active' ? 'success' : 'info'}>
              <strong>Model: {health.model.status.replaceAll('_', ' ')}</strong>
              <p>{health.model.reason}</p>
            </Notice>
            <dl className="eta-diagnostics-grid">
              {Object.entries({
                'Total observations': health.total_observations,
                'Verified arrivals': health.verified_arrivals,
                'Completed trips with usable samples': health.completed_trips,
                'Incomplete observations': health.incomplete_observations,
                'Rejected observation checks': health.rejected_checks,
              }).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p>
              Training requires at least{' '}
              <strong>
                {health.requirements.minimum_observations} verified observations from{' '}
                {health.requirements.minimum_completed_trips} completed real trips
              </strong>
              , with {health.requirements.minimum_training_trips} training trips and{' '}
              {health.requirements.minimum_holdout_trips} later test trips after chronological
              purging. This is a minimum experiment size, not an accuracy guarantee.
            </p>
            {health.verified_arrivals < health.requirements.minimum_observations && (
              <p>
                Still needed: at least{' '}
                {Math.max(0, health.requirements.minimum_observations - health.verified_arrivals)}{' '}
                verified observations and{' '}
                {Math.max(0, health.requirements.minimum_completed_trips - health.completed_trips)}{' '}
                completed trips. Routing stays approximate until a trained model improves on its
                baseline.
              </p>
            )}
            {health.model.metrics && (
              <p>
                Latest chronological evaluation: model MAE{' '}
                {health.model.metrics.model_mae_minutes.toFixed(2)} min; routing MAE{' '}
                {health.model.metrics.routing_mae_minutes.toFixed(2)} min. Training trips:{' '}
                {health.model.metrics.training_trips}; test trips:{' '}
                {health.model.metrics.holdout_trips}.
              </p>
            )}
            <h3>Why observations are missing</h3>
            {!health.active_trips.length && (
              <p>No active trips. Start an assigned real service trip and share accurate GPS.</p>
            )}
            {health.active_trips.map((t) => (
              <div className="eta-trip-health" key={t.trip_id}>
                <strong>{t.bus}</strong>
                <p>
                  {t.demo_data
                    ? 'Demo/test bus: excluded from real training. Use an actual service vehicle for field collection.'
                    : t.has_gps
                      ? `GPS: ${locationAge(t.gps_updated_at ?? undefined)}; accuracy ${t.gps_accuracy_m ?? 'unknown'} m.`
                      : 'No GPS has been published for this trip.'}
                </p>
                <p>
                  {t.open_requests
                    ? `${t.open_requests} confirmed pickup requests available.`
                    : 'No pending or accepted pickup requests; there is no verified target to collect against.'}
                </p>
                <p>
                  {t.collection
                    ? `Last collection: ${locationAge(t.collection.checked_at)}; ${t.collection.status.replaceAll('_', ' ')}; ${t.collection.recorded} recorded / ${t.collection.attempted} checked.`
                    : 'No collection check received. The assigned driver must use the updated Employee Dashboard and start GPS sharing.'}
                </p>
              </div>
            ))}
            {Object.entries(health.rejection_reasons).map(([reason, count]) => (
              <p key={reason}>
                <strong>{count}</strong> · {reasonText[reason] ?? reason.replaceAll('_', ' ')}
              </p>
            ))}
            <p className="form-help">
              Rejected checks without road features are diagnostics, not training observations. An
              accepted pickup is never proof of arrival. Samples require accurate GPS and two
              qualifying arrival fixes; the passenger may close their page. The driver's GPS-sharing
              page must stay active.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
