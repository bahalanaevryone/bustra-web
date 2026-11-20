import { useCallback, useEffect, useState } from 'react'
import { MapPin, UserRound } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { rpc, requireClient } from '../lib/supabase/client'
import { useData } from '../hooks/useData'
import type { PickupRequest } from '../types'
import { Empty, Loading, Modal, Notice, Status } from '../components/ui'
import { date, errorMessage, time } from '../lib/utils'
export function Account() {
  const { user, profile, refresh: refreshProfile } = useAuth()
  const { feed } = useData()
  const [requests, setRequests] = useState<PickupRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancel, setCancel] = useState<string>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await requireClient()
      .from('pickup_requests')
      .select('*')
      .eq('user_id', user!.id)
      .order('requested_at', { ascending: false })
    if (error) setError(error.message)
    else setRequests(data as PickupRequest[])
    setLoading(false)
  }, [user])
  useEffect(() => {
    void load()
    const client = requireClient()
    const channel = client
      .channel(`my-requests-${user!.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pickup_requests',
          filter: `user_id=eq.${user!.id}`,
        },
        () => {
          void load()
        },
      )
      .subscribe()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    return () => {
      clearInterval(interval)
      void client.removeChannel(channel)
    }
  }, [user, load])
  async function cancelRequest() {
    setBusy(true)
    setError('')
    try {
      await rpc('cancel_pickup', { p_request: cancel })
      setCancel(undefined)
      setNotice('Pickup request cancelled.')
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function saveProfile(form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error } = await requireClient()
        .from('profiles')
        .update({
          first_name: String(values.first_name).trim(),
          last_name: String(values.last_name).trim(),
        })
        .eq('id', user!.id)
      if (error) throw error
      await refreshProfile()
      setNotice('Your profile has been updated.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="container page-space">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR BUSTRA ACCOUNT</span>
          <h1>Hello, {profile?.first_name}.</h1>
          <p>Keep track of your pickup requests and account details.</p>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      <div className="account-grid">
        <section className="card">
          <div className="card-heading">
            <h2>
              <MapPin size={19} /> My pickup requests
            </h2>
          </div>
          {loading ? (
            <Loading />
          ) : requests.length ? (
            requests.map((r) => {
              const trip = feed.trips.find((t) => t.id === r.trip_id)
              return (
                <article className="request-card" key={r.id}>
                  <div className="row-between">
                    <strong>
                      {feed.pickup_points.find((p) => p.id === r.pickup_point_id)?.name ||
                        'Pickup point'}
                    </strong>
                    <Status value={r.status} />
                  </div>
                  <p>
                    {feed.routes.find((route) => route.id === trip?.route_id)?.route_name ||
                      `Trip ${r.trip_id.slice(0, 8)}`}
                  </p>
                  <small>
                    Requested {date(r.requested_at)}, {time(r.requested_at)} · PHT
                  </small>
                  {r.status === 'pending' && (
                    <button className="text-button danger-text" onClick={() => setCancel(r.id)}>
                      Cancel request
                    </button>
                  )}
                  {r.status === 'accepted' && (
                    <p className="form-help">
                      The driver acknowledged your request. Boarding remains subject to conditions
                      and available space.
                    </p>
                  )}
                </article>
              )
            })
          ) : (
            <Empty title="Your next journey starts here">
              Choose a bus on the live map to request a pickup. This is not a seat reservation.
            </Empty>
          )}
        </section>
        <section className="card profile-card">
          <div className="card-heading">
            <h2>
              <UserRound size={19} /> Your profile
            </h2>
          </div>
          <form
            key={profile?.id}
            onSubmit={(e) => {
              e.preventDefault()
              void saveProfile(e.currentTarget)
            }}
          >
            <label className="field">
              <span>First name</span>
              <input name="first_name" required maxLength={80} defaultValue={profile?.first_name} />
            </label>
            <label className="field">
              <span>Last name</span>
              <input name="last_name" required maxLength={80} defaultValue={profile?.last_name} />
            </label>
            <label className="field">
              <span>Email address</span>
              <input value={user?.email || ''} readOnly />
            </label>
            <p className="form-help">Account access: {profile?.role}</p>
            <button className="button button-primary" disabled={busy}>
              Save changes
            </button>
          </form>
        </section>
      </div>
      {cancel && (
        <Modal title="Cancel this pickup request?" onClose={() => setCancel(undefined)}>
          <p>The assigned employee will see that you are no longer waiting for this request.</p>
          <div className="modal-actions">
            <button className="button button-outline" onClick={() => setCancel(undefined)}>
              Keep request
            </button>
            <button
              className="button button-danger"
              disabled={busy}
              onClick={() => {
                void cancelRequest()
              }}
            >
              {busy ? 'Cancelling…' : 'Cancel request'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
