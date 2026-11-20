import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc } from '../lib/supabase/client'
import { errorMessage } from '../lib/utils'
export function useLocationSharing(tripId: string | undefined, allowed: boolean) {
  const watch = useRef<number | null>(null)
  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState('Location sharing is off.')
  const [lastUpdate, setLastUpdate] = useState<string>()
  const generation = useRef(0)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!sharing) return
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [sharing])
  const stop = useCallback(() => {
    generation.current++
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    watch.current = null
    setSharing(false)
    setStatus('Location sharing is off. The last reported position will become outdated.')
  }, [])
  useEffect(() => {
    stop()
    setLastUpdate(undefined)
    return stop
  }, [tripId, allowed, stop])
  useEffect(() => {
    const offline = () => {
      stop()
      setStatus('You’re offline. Reconnect and start sharing again.')
    }
    window.addEventListener('offline', offline)
    return () => window.removeEventListener('offline', offline)
  }, [stop])
  function start() {
    if (!allowed || !tripId) return
    if (!window.isSecureContext) {
      setStatus('GPS sharing needs HTTPS or localhost.')
      return
    }
    if (!navigator.geolocation) {
      setStatus('Geolocation is not supported in this browser.')
      return
    }
    if (!navigator.onLine) {
      setStatus('You’re offline. Reconnect before sharing.')
      return
    }
    if (watch.current !== null) return
    const currentGeneration = ++generation.current
    let lastWrite = 0
    let writing = false
    let lastCoords: [number, number] | null = null
    setSharing(true)
    setLastUpdate(undefined)
    setStatus('Waiting for GPS permission and a position…')
    watch.current = navigator.geolocation.watchPosition(
      async (position) => {
        if (currentGeneration !== generation.current) return
        const { latitude, longitude, accuracy, speed } = position.coords
        if (accuracy > 100) {
          const range =
            accuracy >= 1000 ? `${(accuracy / 1000).toFixed(1)} km` : `${Math.round(accuracy)} m`
          setStatus(
            `Device location is too approximate (±${range}). Bus location has not been updated. Enable precise location on a GPS-enabled phone; waiting for accuracy within 100 m.`,
          )
          return
        }
        const elapsed = Date.now() - lastWrite
        const moved =
          !lastCoords ||
          Math.hypot(
            latitude - lastCoords[0],
            (longitude - lastCoords[1]) * Math.cos((latitude * Math.PI) / 180),
          ) *
            111000 >
            10
        if (writing || elapsed < 10000 || (!moved && elapsed < 30000)) return
        writing = true
        try {
          await rpc('publish_location', {
            p_trip: tripId,
            p_lat: latitude,
            p_lng: longitude,
            p_speed: speed !== null && speed >= 0 ? Math.min(200, speed * 3.6) : null,
            p_accuracy: accuracy,
          })
          if (currentGeneration !== generation.current) return
          lastWrite = Date.now()
          lastCoords = [latitude, longitude]
          setLastUpdate(new Date().toISOString())
          setStatus(`Sharing location · accuracy ±${Math.round(accuracy)} m`)
        } catch (e) {
          if (currentGeneration === generation.current) {
            stop()
            setStatus(`Sharing stopped: ${errorMessage(e)}`)
          }
        } finally {
          writing = false
        }
      },
      (error) => {
        if (currentGeneration !== generation.current) return
        if (error.code === 1) {
          stop()
          setStatus('GPS permission denied. Allow location in browser settings, then start again.')
        } else
          setStatus(
            error.code === 3
              ? 'GPS timed out. Waiting for another signal…'
              : 'GPS position unavailable. Move to a clearer area.',
          )
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
  }
  const displayStatus =
    sharing && lastUpdate && now - Date.parse(lastUpdate) > 90000
      ? 'Last bus location is outdated. Waiting for a fresh device position; keep this page active with precise location enabled.'
      : status
  return { sharing, status: displayStatus, lastUpdate, start, stop }
}
