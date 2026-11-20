import { useCallback, useEffect, useRef, useState } from 'react'
import { requireClient } from '../lib/supabase/client'
import type { Bus, PickupRequest, Profile, Route, Trip } from '../types'
import { useAuth } from '../features/auth/AuthProvider'
export interface Operations {
  profiles: Profile[]
  buses: Bus[]
  routes: Route[]
  trips: Trip[]
  pickup_requests: PickupRequest[]
}
const initial: Operations = {
  profiles: [],
  buses: [],
  routes: [],
  trips: [],
  pickup_requests: [],
}
export function useOperations() {
  const { user, profile } = useAuth()
  const owner = `${user?.id}:${profile?.role}`
  const currentOwner = useRef(owner)
  currentOwner.current = owner
  const [state, setState] = useState({ owner: '', data: initial })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    const client = requireClient()
    const keys = ['profiles', 'buses', 'routes', 'trips', 'pickup_requests'] as const
    const results = await Promise.all(
      keys.map((key) =>
        client
          .from(key)
          .select(
            key === 'routes'
              ? 'id,route_name,origin,destination,origin_lat,origin_lng,destination_lat,destination_lng,origin_latitude,origin_longitude,destination_latitude,destination_longitude,is_approved,road_path'
              : '*',
          )
          .limit(1000),
      ),
    )
    if (currentOwner.current !== owner) return
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
    else {
      setState({
        owner,
        data: Object.fromEntries(
          keys.map((key, i) => [key, results[i].data]),
        ) as unknown as Operations,
      })
      setError('')
    }
    setLoading(false)
  }, [owner])
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
  return { data: state.owner === owner ? state.data : initial, error, loading, refresh: load }
}
