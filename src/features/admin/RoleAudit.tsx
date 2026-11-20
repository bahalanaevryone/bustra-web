import { useEffect, useState } from 'react'
import type { Profile } from '../../types'
import { Notice } from '../../components/ui'
import { rpc } from '../../lib/supabase/client'
import { date, errorMessage, time } from '../../lib/utils'

interface AuditEntry {
  id: number
  actor_id: string | null
  target_id: string
  old_role: string
  new_role: string | null
  changed_at: string
  source: string
}
export function RoleAudit({ profiles }: { profiles: Profile[] }) {
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    void rpc<AuditEntry[]>('role_change_history', { p_limit: 30 })
      .then((data) => {
        if (!disposed) {
          setRows(data)
          setError('')
        }
      })
      .catch((e) => {
        if (!disposed) setError(errorMessage(e))
      })
    return () => {
      disposed = true
    }
  }, [profiles])
  function name(id: string | null) {
    if (!id) return 'Trusted database operation'
    const p = profiles.find((p) => p.id === id)
    return p ? `${p.first_name} ${p.last_name}` : id
  }
  return (
    <section className="card management-card" aria-label="Role change history">
      <div className="card-heading">
        <h2>Role change history</h2>
      </div>
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Change</th>
                <th>Changed by</th>
                <th>When (PHT)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{name(row.target_id)}</td>
                  <td>
                    {row.old_role} → {row.new_role || 'Account removed'}
                  </td>
                  <td>{name(row.actor_id)}</td>
                  <td>
                    {date(row.changed_at)}, {time(row.changed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-footnote">No role changes recorded since audit logging was enabled.</p>
      )}
    </section>
  )
}
