import { useCallback, useEffect, useState } from 'react'
import { requireClient } from '../lib/supabase/client'
import type { Bus, PickupPoint, PickupRequest, Profile, Route, Trip } from '../types'
import { useAuth } from '../features/auth/AuthProvider'
export interface Operations {
  profiles: Profile[]
  buses: Bus[]
  routes: Route[]
  pickup_points: PickupPoint[]
  trips: Trip[]
  pickup_requests: PickupRequest[]
}
const initial: Operations = {
  profiles: [],
  buses: [],
  routes: [],
  pickup_points: [],
  trips: [],
  pickup_requests: [],
}
export function useOperations() {
  const { user, profile } = useAuth()
  const [data, setData] = useState<Operations>(initial)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    const client = requireClient()
    const keys = [
      'profiles',
      'buses',
      'routes',
      'pickup_points',
      'trips',
      'pickup_requests',
    ] as const
    const results = await Promise.all(keys.map((key) => client.from(key).select('*').limit(1000)))
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
    else {
      setData(
        Object.fromEntries(keys.map((key, i) => [key, results[i].data])) as unknown as Operations,
      )
      setError('')
    }
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
    const client = requireClient()
    let channel = client.channel(`operations-${user?.id}-${profile?.role}`)
    for (const table of ['trips', 'pickup_requests', 'profiles', 'bus_location'])
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void load()
      })
    channel.subscribe()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    return () => {
      clearInterval(interval)
      void client.removeChannel(channel)
    }
  }, [load, user?.id, profile?.role])
  return { data, error, loading, refresh: load }
}
