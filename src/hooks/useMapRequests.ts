import { useEffect, useState } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import { supabase } from '../lib/supabase/client'
import type { MapRequest } from '../types'

// RLS scopes these rows to the owner or assigned trip employee.
// No passenger request data enters the guest public feed.
export function useMapRequests(enabled = true) {
  const { user, profile } = useAuth()
  const [state, setState] = useState<{ owner: string; requests: MapRequest[] }>({
    owner: '',
    requests: [],
  })
  useEffect(() => {
    if (!user || !supabase || !enabled) return
    let disposed = false
    async function load() {
      const { data, error } = await supabase!
        .from('pickup_requests')
        .select('id,trip_id,pickup_latitude,pickup_longitude,pickup_address,status,requested_at')
        .in('status', ['pending', 'accepted'])
        .limit(1000)
      if (!disposed)
        setState({
          owner: `${user!.id}:${profile?.role}`,
          requests: error ? [] : (data as MapRequest[]),
        })
    }
    void load()
    const channel = supabase
      .channel(`map-requests-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_requests' }, () => {
        void load()
      })
      .subscribe()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    return () => {
      disposed = true
      clearInterval(interval)
      void supabase!.removeChannel(channel)
    }
  }, [user?.id, profile?.role, enabled])
  return enabled && state.owner === `${user?.id}:${profile?.role}` ? state.requests : []
}
