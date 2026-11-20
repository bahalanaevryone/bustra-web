import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '../../types'
import { supabase } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'

interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  error: string
  refresh: () => Promise<void>
  logout: () => Promise<void>
}
const AuthContext = createContext<AuthState>(null!)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(!!supabase)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (!session) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])
  const refresh = useCallback(async () => {
    if (!supabase || !user) {
      setLoading(false)
      return
    }
    const { data, error: failure } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    if (failure) {
      setError(`Unable to load your account permissions: ${failure.message}`)
      setProfile(null)
    } else {
      setProfile(data as Profile)
      setError('')
    }
    setLoading(false)
  }, [user])
  useEffect(() => {
    if (!user || !supabase) return
    let disposed = false
    setLoading(true)
    const load = async () => {
      const { data, error: failure } = await supabase!
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (disposed) return
      setProfile(failure ? null : (data as Profile))
      setError(failure ? `Unable to load your account permissions: ${failure.message}` : '')
      setLoading(false)
    }
    void load()
    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        () => {
          void load()
        },
      )
      .subscribe()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    return () => {
      disposed = true
      clearInterval(interval)
      void supabase!.removeChannel(channel)
    }
  }, [user])
  async function logout() {
    const result = await supabase?.auth.signOut()
    if (result?.error) throw new Error(errorMessage(result.error))
    setUser(null)
    setProfile(null)
  }
  return (
    <AuthContext.Provider value={{ user, profile, loading, error, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
export const useAuth = () => useContext(AuthContext)
