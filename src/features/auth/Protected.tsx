import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import type { Role } from '../../types'
import { Loading, Notice } from '../../components/ui'
export function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, profile, loading, error, refresh } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user)
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  if (!profile)
    return (
      <div className="container page-space">
        <Notice tone="error">{error || 'Your profile is unavailable.'}</Notice>
        <button
          className="button button-outline"
          onClick={() => {
            void refresh()
          }}
        >
          Retry permissions
        </button>
      </div>
    )
  if (roles && !roles.includes(profile.role))
    return (
      <Navigate
        to={
          profile.role === 'admin'
            ? '/admin'
            : profile.role === 'employee'
              ? '/employee'
              : '/requests'
        }
        replace
      />
    )
  return children
}
