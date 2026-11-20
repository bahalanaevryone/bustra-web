import { useState } from 'react'
import { MapPin, Users, Clock, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../../hooks/useData'
import { useAuth } from '../auth/AuthProvider'
import { rpc } from '../../lib/supabase/client'
import { errorMessage, isFresh, locationAge, time } from '../../lib/utils'
import { Modal, Notice, Status } from '../../components/ui'
import { validPickupPoints } from '../map/routeGeometry'

export function BusDetails({
  tripId,
  onClose,
  initialPoint = '',
}: {
  tripId: string
  onClose: () => void
  initialPoint?: string
}) {
  const { feed, demo } = useData()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [point, setPoint] = useState(initialPoint)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const trip = feed.trips.find((t) => t.id === tripId)
  const bus = feed.buses.find((b) => b.id === trip?.bus_id)
  const route = feed.routes.find((r) => r.id === trip?.route_id)
  const location = feed.locations.find((l) => l.trip_id === tripId)
  if (!trip || !bus)
    return (
      <Modal title="Bus unavailable" onClose={onClose}>
        <p>This trip is no longer publicly available.</p>
      </Modal>
    )
  const points = validPickupPoints(route, feed.pickup_points)
  async function request() {
    if (!points.some((p) => p.id === point)) {
      setError('Choose a valid pickup stop on this approved bus route.')
      return
    }
    if (!user) {
      navigate(`/login?returnTo=${encodeURIComponent(`/map?trip=${tripId}&point=${point}`)}`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await rpc('request_pickup', { p_trip: tripId, p_point: point })
      setSuccess(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={bus.plate_number} onClose={onClose}>
      <div className="detail-route">
        <Status value={trip.status} />
        <h3>{route?.route_name}</h3>
        <p>
          {route?.origin} to {route?.destination}
        </p>
      </div>
      <div className="detail-stats">
        <div>
          <Users size={19} />
          <strong>{Math.max(0, bus.capacity - trip.onboard_count)}</strong>
          <span>Reported spaces</span>
        </div>
        <div>
          <Clock size={19} />
          <strong>{time(trip.departure_at)}</strong>
          <span>Departure</span>
        </div>
      </div>
      <p className="muted">
        {trip.onboard_count} of {bus.capacity} passengers aboard
      </p>
      <Notice tone={location && !demo && isFresh(location.updated_at) ? 'success' : 'info'}>
        {demo ? 'DEMO · This bus position is illustrative.' : locationAge(location?.updated_at)}
        {location && !isFresh(location.updated_at) && !demo && ' · Current position is unknown.'}
      </Notice>
      <p className="muted">
        ETA unavailable · Road travel data is not configured. AI prediction is planned / not
        trained.
      </p>
      {success ? (
        <Notice tone="success">
          Request sent. Track the response in{' '}
          <button className="text-button" onClick={() => navigate('/requests')}>
            My requests
          </button>
          .
        </Notice>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void request()
          }}
        >
          <label className="field">
            <span>
              <MapPin size={16} /> Pickup point
            </span>
            <select value={point} onChange={(e) => setPoint(e.target.value)} required>
              <option value="">Choose a designated stop</option>
              {points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          {!route?.is_approved && (
            <Notice tone="info">
              This route is awaiting operator review. Pickup requests open after the road path and
              designated stops are approved.
            </Notice>
          )}
          <button
            disabled={demo || busy || trip.status !== 'active' || !points.length}
            className="button button-primary full-width"
            type="submit"
          >
            {busy ? 'Sending…' : user ? 'Request pickup' : 'Log in to request pickup'}
          </button>
          {demo && <p className="form-help">Requests are disabled for illustrative demo trips.</p>}
        </form>
      )}
      <p className="fine-print">
        <ShieldCheck size={16} /> A request alerts the assigned employee. It does not reserve a seat
        or guarantee boarding.
      </p>
    </Modal>
  )
}
