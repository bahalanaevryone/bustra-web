import { requireClient } from '../../lib/supabase/client'

// Best effort: a router outage must never interrupt driver GPS publication.
export async function collectEtaObservations(tripId: string) {
  try {
    await requireClient().functions.invoke('predict-eta', {
      body: { trip_id: tripId, collect: true },
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    /* Next GPS collection interval retries. */
  }
}
