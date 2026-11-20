import { useState } from 'react'
import type { Profile, Role } from '../../types'
import { Modal, Notice } from '../../components/ui'
import { rpc } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'
import { useAuth } from '../auth/AuthProvider'

export function UserEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { user, refresh } = useAuth()
  const [firstName, setFirstName] = useState(profile.first_name)
  const [lastName, setLastName] = useState(profile.last_name)
  const [role, setRole] = useState<Role>(profile.role)
  const [originalRole] = useState(profile.role)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const adminTransition = role !== originalRole && (role === 'admin' || originalRole === 'admin')
  const granting = role === 'admin'
  async function save(confirmed = false) {
    if (adminTransition && !confirmed) {
      setError('')
      setConfirming(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      await rpc('admin_update_user', {
        p_user: profile.id,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_role: role,
        p_confirm_admin: confirmed,
        p_expected_role: originalRole,
      })
      if (user?.id === profile.id) await refresh()
      await onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  if (confirming)
    return (
      <Modal
        title={granting ? 'Assign Admin privileges?' : 'Remove Admin privileges?'}
        onClose={() => {
          if (!busy) setConfirming(false)
        }}
      >
        <p>
          <strong>
            {firstName} {lastName}
          </strong>{' '}
          will change from <strong>{originalRole}</strong> to <strong>{role}</strong>.
        </p>
        <p>
          {granting
            ? 'This account will be able to manage users, assign Admin access and manage system data.'
            : 'This account will lose Admin management access. Its dashboard will follow the new role.'}
        </p>
        <p className="form-help">
          The last active Admin is protected. This role change will be recorded in the audit
          history.
        </p>
        {user?.id === profile.id && (
          <Notice>Your own dashboard access will change after saving.</Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          <button
            className="button button-outline"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Go back
          </button>
          <button
            className={`button ${granting ? 'button-primary' : 'button-danger'}`}
            disabled={busy}
            onClick={() => void save(true)}
          >
            {busy ? 'Saving...' : granting ? 'Confirm Admin access' : 'Confirm removal'}
          </button>
        </div>
      </Modal>
    )
  return (
    <Modal
      title="Edit user"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="field">
          <span>First name</span>
          <input
            required
            maxLength={80}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Last name</span>
          <input
            required
            maxLength={80}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Account access</span>
          <select
            required
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={busy}
          >
            <option value="user">User</option>
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <p className="form-help">
          Admin changes require confirmation. The last active Admin cannot be demoted. Reassign
          unfinished trips before changing an Employee's role.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          <button className="button button-outline" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
