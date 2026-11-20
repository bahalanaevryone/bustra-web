import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { emptyFeed, errorMessage } from '../lib/utils'
import { rpc, supabase } from '../lib/supabase/client'
import { demoFeed } from '../lib/demo'
import { useAuth } from '../features/auth/AuthProvider'
import type { PublicFeed } from '../types'

interface DataState {
  feed: PublicFeed
  loading: boolean
  error: string
  demo: boolean
  setDemo: (v: boolean) => void
  refresh: () => Promise<void>
  lastSync: string | null
}
const DataContext = createContext<DataState>(null!)
export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [demo, setDemo] = useState(new URLSearchParams(location.search).get('demo') === '1')
  const [feed, setFeed] = useState<PublicFeed>(emptyFeed)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (demo) {
      setFeed(demoFeed())
      setLoading(false)
      setError('')
      return
    }
    try {
      const data = await rpc<PublicFeed>('public_feed')
      setFeed(data)
      setLastSync(new Date().toISOString())
      setError('')
    } catch (e) {
      setError(errorMessage(e))
      setFeed(emptyFeed)
    } finally {
      setLoading(false)
    }
  }, [demo])
  useEffect(() => {
    let disposed = false
    async function load() {
      if (demo) {
        setFeed(demoFeed())
        setLoading(false)
        setError('')
        return
      }
      try {
        const data = await rpc<PublicFeed>('public_feed')
        if (!disposed) {
          setFeed(data)
          setLastSync(new Date().toISOString())
          setError('')
        }
      } catch (e) {
        if (!disposed) {
          setError(errorMessage(e))
          setFeed(emptyFeed)
        }
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    setLoading(true)
    void load()
    if (demo)
      return () => {
        disposed = true
      }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    const channel = supabase
      ?.channel(`public-feed-${user?.id ?? 'guest'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bus_location' }, () => {
        void load()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
        void load()
      })
      .subscribe()
    return () => {
      disposed = true
      clearInterval(interval)
      if (channel) void supabase!.removeChannel(channel)
    }
  }, [demo, user?.id])
  return (
    <DataContext.Provider value={{ feed, loading, error, demo, setDemo, refresh, lastSync }}>
      {children}
    </DataContext.Provider>
  )
}
export const useData = () => useContext(DataContext)
