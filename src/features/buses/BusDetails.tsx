import { useEffect, useState } from 'react'
import { Users, Clock, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../../hooks/useData'
import { useAuth } from '../auth/AuthProvider'
import { isFresh, locationAge, time } from '../../lib/utils'
import { Modal, Notice, Status } from '../../components/ui'
import { PickupSelector } from '../pickups/PickupSelector'

export function BusDetails({
  tripId,
  onClose,
  initialPickup = false,
}: {
  tripId: string
  onClose: () => void
  initialPickup?: boolean
}) {
  const { feed, demo } = useData()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [choosing, setChoosing] = useState(false)
  const [success, setSuccess] = useState(false)
  const trip = feed.trips.find((t) => t.id === tripId)
  const bus = feed.buses.find((b) => b.id === trip?.bus_id)
  const route = feed.routes.find((r) => r.id === trip?.route_id)
  const location = feed.locations.find((l) => l.trip_id === tripId)
  useEffect(() => {
    if (initialPickup && user && profile?.role === 'user' && !demo && trip?.status === 'active')
      setChoosing(true)
  }, [initialPickup, user?.id, profile?.role, demo, trip?.status])
  if (!trip || !bus)
    return (
      <Modal title="Bus unavailable" onClose={onClose}>
        <p>This trip is no longer publicly available.</p>
      </Modal>
    )
  function request() {
    if (!user) {
      navigate(`/login?returnTo=${encodeURIComponent(`/map?trip=${tripId}&pickup=1`)}`)
      return
    }
    setChoosing(true)
  }
  if (choosing)
    return (
      <Modal title="Choose pickup location" onClose={onClose} className="pickup-modal">
        <PickupSelector
          tripId={tripId}
          busLabel={bus.plate_number}
          route={route}
          onBack={() => setChoosing(false)}
          onSent={() => {
            setChoosing(false)
            setSuccess(true)
          }}
        />
      </Modal>
    )
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
        <div>
          {user && profile?.role !== 'user' && (
            <Notice>Use a passenger account to request pickup.</Notice>
          )}
          <button
            disabled={
              demo ||
              trip.status !== 'active' ||
              (!!user && profile?.role !== 'user') ||
              trip.onboard_count >= bus.capacity
            }
            className="button button-primary full-width"
            onClick={request}
          >
            {trip.onboard_count >= bus.capacity
              ? 'Bus currently full'
              : user
                ? 'Request Pickup'
                : 'Log in to request pickup'}
          </button>
          {demo && <p className="form-help">Requests are disabled for illustrative demo trips.</p>}
        </div>
      )}
      <p className="fine-print">
        <ShieldCheck size={16} /> A request alerts the assigned employee. It does not reserve a seat
        or guarantee boarding.
      </p>
    </Modal>
  )
}
