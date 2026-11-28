import { useData } from '../../hooks/useData'
import { locationAge } from '../../lib/utils'
import type { Coordinate } from '../map/routeGeometry'
import { useEta } from './useEta'

export function EtaPanel({ tripId, pin }: { tripId: string; pin: Coordinate | null }) {
  const eta = useEta(tripId, pin)
  return <EtaPanelContent tripId={tripId} eta={eta} />
}
export function EtaPanelContent({
  tripId,
  eta,
}: {
  tripId: string
  eta: ReturnType<typeof useEta>
}) {
  const { feed } = useData()
  const { result, message } = eta
  const updated = feed.locations.find((l) => l.trip_id === tripId)?.updated_at
  return (
    <section className="eta-panel" aria-label="Pickup arrival estimate" aria-live="polite">
      <strong>{result?.source === 'ai' ? 'AI-predicted ETA' : 'Approximate ETA'}</strong>
      {result?.minutes != null && (
        <p className="eta-minutes">
          {result.minutes < 1 ? 'Less than 1 minute' : `${Math.ceil(result.minutes)} min`}
        </p>
      )}
      {result?.road_distance_m != null && (
        <p>Remaining road distance: {(result.road_distance_m / 1000).toFixed(2)} km</p>
      )}
      <p>{message || result?.message}</p>
      {result?.diagnostics && (
        <p className="form-help">
          Bus distance from route: {result.diagnostics.bus_offset_m ?? 'unknown'} m · Pickup
          distance from route: {result.diagnostics.pickup_offset_m ?? 'unknown'} m.
        </p>
      )}
      <small>Last location update: {locationAge(updated)}</small>
    </section>
  )
}
