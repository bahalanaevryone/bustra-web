import { useEffect, useRef, useState } from 'react'
import { useData } from '../../hooks/useData'
import { requireClient } from '../../lib/supabase/client'
import type { Coordinate } from '../map/routeGeometry'
import type { EtaResult } from '../../../supabase/functions/_shared/eta'
import { checkFix, EtaUnavailable } from '../../../supabase/functions/_shared/eta'

export function useEta(tripId: string, pin: Coordinate | null) {
  const { feed, demo } = useData()
  const fix = feed.locations.find((l) => l.trip_id === tripId)
  const key = JSON.stringify([tripId, pin])
  const last = useRef({ key: '', started: 0 })
  const [, setTick] = useState(0)
  const online = navigator.onLine
  const [state, setState] = useState<{ key: string; result?: EtaResult; error?: string }>({
    key: '',
  })
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1)
    const interval = setInterval(refresh, 15000)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [])
  useEffect(() => {
    if (!pin || demo || !fix || !online) return
    try {
      checkFix({ ...fix, accuracy_m: fix.accuracy_m ?? null, speed_kmh: fix.speed_kmh ?? null })
    } catch {
      return
    }
    let disposed = false
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout>
    let timeout: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      if (disposed) return
      try {
        checkFix({ ...fix, accuracy_m: fix.accuracy_m ?? null, speed_kmh: fix.speed_kmh ?? null })
      } catch {
        return
      }
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(() => void run(), 15000)
        return
      }
      controller = new AbortController()
      last.current = { key, started: Date.now() }
      timeout = setTimeout(() => {
        setState({ key, error: 'ETA request timed out. Retrying shortly.' })
        controller?.abort()
      }, 25000)
      try {
        const { data, error } = await requireClient().functions.invoke<EtaResult>('predict-eta', {
          body: { trip_id: tripId, pickup_latitude: pin[0], pickup_longitude: pin[1] },
          signal: controller.signal,
        })
        if (disposed || controller.signal.aborted) return
        if (error || !data || typeof data.status !== 'string') throw new Error('ETA unavailable')
        setState({ key, result: data })
      } catch {
        if (!disposed && !controller.signal.aborted)
          setState({ key, error: 'ETA unavailable. Check your connection or try again shortly.' })
      } finally {
        clearTimeout(timeout)
        if (!disposed)
          timer = setTimeout(
            () => void run(),
            Math.max(350, 15000 - (Date.now() - last.current.started)),
          )
      }
    }
    const delay =
      last.current.key === key ? Math.max(350, 15000 - (Date.now() - last.current.started)) : 500
    timer = setTimeout(() => void run(), delay)
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(timeout)
      controller?.abort()
    }
  }, [key, fix?.updated_at, online, demo])
  if (!pin) return { message: 'Choose a pickup pin to see its Approximate ETA.' }
  if (demo) return { message: 'ETA is disabled for illustrative demo trips.' }
  if (!navigator.onLine) return { message: 'You are offline. Reconnect for a fresh ETA.' }
  try {
    checkFix(
      fix ? { ...fix, accuracy_m: fix.accuracy_m ?? null, speed_kmh: fix.speed_kmh ?? null } : null,
    )
  } catch (e) {
    return { message: e instanceof EtaUnavailable ? e.message : 'Waiting for GPS.' }
  }
  if (state.key !== key) return { message: 'Calculating Approximate ETA...' }
  // A superseded GPS fix must never keep displaying an earlier prediction.
  if (state.result?.location_updated_at && state.result.location_updated_at !== fix?.updated_at)
    return { message: 'Updating Approximate ETA...' }
  return { result: state.result, message: state.error }
}
