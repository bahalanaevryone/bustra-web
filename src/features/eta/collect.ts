import { requireClient } from '../../lib/supabase/client'

// Best effort: a router outage must never interrupt driver GPS publication.
const inFlight = new Map<string, Promise<string>>()
export function collectEtaObservations(tripId: string): Promise<string> {
  const previous = inFlight.get(tripId)
  if (previous) return previous
  const task = collect(tripId).finally(() => inFlight.delete(tripId))
  inFlight.set(tripId, task)
  return task
}
async function collect(tripId: string): Promise<string> {
  try {
    const { data, error } = await requireClient().functions.invoke('predict-eta', {
      body: { trip_id: tripId, collect: true },
      signal: AbortSignal.timeout(65000),
    })
    if (error) throw error
    if (data?.reason === 'no_open_requests')
      return 'AI data: waiting for confirmed pickup requests.'
    if (data?.status !== 'ok')
      return `AI data: ${data?.message ?? 'waiting for valid GPS and route data.'}`
    const reasons = Object.keys(data?.reasons ?? {})
      .join(', ')
      .replaceAll('_', ' ')
    return `AI data: ${data?.processed ?? 0} observations recorded${reasons ? `; skipped: ${reasons}` : ''}.`
  } catch {
    return 'AI data collection failed. GPS sharing continues; check Route diagnostics.'
  }
}
