import { useEffect, useRef, useState } from 'react'
import { Crosshair, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Notice } from '../../components/ui'
import type { Route } from '../../types'
import type { Coordinate } from '../map/routeGeometry'
import { validCoordinate } from '../map/routeGeometry'
import { rpc } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'
import { reverseLocation } from '../schedules/geocoding'
import { PickupMap } from './PickupMap'
import { EtaPanel } from '../eta/EtaPanel'
import { requireClient } from '../../lib/supabase/client'
import '../../styles/schedule.css'

interface Assessment {
  verification: 'unverified' | 'near_suggested_route' | 'near_reviewed_route' | 'too_far'
  distance_m: number | null
  can_request: boolean
}
export function PickupSelector({
  tripId,
  busLabel,
  route,
  onBack,
  onSent,
}: {
  tripId: string
  busLabel: string
  route?: Route
  onBack: () => void
  onSent: () => void
}) {
  const [pin, setPin] = useState<Coordinate | null>(null)
  const [address, setAddress] = useState('')
  const [gpsMessage, setGpsMessage] = useState(
    'Tap the map to choose a pickup location, or use your current location.',
  )
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [assessment, setAssessment] = useState<{
    key: string
    result?: Assessment
    error?: string
  }>({ key: '' })
  const version = useRef(0)
  const alive = useRef(true)
  const addressRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      version.current++
      addressRequest.current?.abort()
    }
  }, [])
  const key = JSON.stringify(pin)
  function place(p: Coordinate) {
    if (!validCoordinate(...p)) return
    version.current++
    setPin(p)
    setAddress('')
    setConfirmed(false)
    setLocating(false)
    setError('')
  }
  // Reverse lookup is optional; a missing address never discards selected coordinates.
  useEffect(() => {
    if (!pin) return
    const controller = new AbortController()
    addressRequest.current = controller
    const timer = setTimeout(() => {
      void reverseLocation(pin[0], pin[1], controller.signal)
        .then((label) => {
          if (!controller.signal.aborted && label) setAddress(label)
        })
        .catch(() => undefined)
    }, 700)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key])
  useEffect(() => {
    if (!pin) return
    let disposed = false
    const timer = setTimeout(() => {
      void rpc<Assessment>('check_pickup_location', {
        p_trip: tripId,
        p_latitude: pin[0],
        p_longitude: pin[1],
      })
        .then((result) => {
          if (!disposed) setAssessment({ key, result })
        })
        .catch((e) => {
          if (!disposed) setAssessment({ key, error: errorMessage(e) })
        })
    }, 350)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [key, tripId])
  function locate() {
    const generation = ++version.current
    if (!navigator.geolocation) {
      setGpsMessage('GPS is unavailable. Choose a location on the map.')
      return
    }
    setLocating(true)
    setGpsMessage('Getting your location... You can choose on the map at any time.')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!alive.current || generation !== version.current) return
        place([p.coords.latitude, p.coords.longitude])
        setGpsMessage(
          `Device accuracy: +/-${Math.round(p.coords.accuracy)} m. Verify and adjust the pin before confirming.`,
        )
      },
      (e) => {
        if (!alive.current || generation !== version.current) return
        setLocating(false)
        setGpsMessage(
          e.code === 1
            ? 'Location permission denied. You can still choose your pickup on the map.'
            : 'GPS timed out or is unavailable. Choose your pickup on the map.',
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }
  useEffect(() => {
    const generation = version.current
    void navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((permission) => {
        if (alive.current && version.current === generation && permission.state === 'granted')
          locate()
      })
      .catch(() => undefined)
  }, [])
  const current = assessment.key === key ? assessment : undefined
  async function submit() {
    if (!pin || !confirmed || !current?.result?.can_request) return
    setBusy(true)
    setError('')
    try {
      await rpc('request_pickup', {
        p_trip: tripId,
        p_latitude: pin[0],
        p_longitude: pin[1],
        p_address: address.trim() || null,
      })
      // Capture the initial routing features after confirmation, while the request exists.
      void requireClient()
        .functions.invoke('predict-eta', {
          body: { trip_id: tripId, pickup_latitude: pin[0], pickup_longitude: pin[1] },
          signal: AbortSignal.timeout(15000),
        })
        .catch(() => undefined)
      onSent()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pickup-selector">
      <p>
        <strong>Selected bus: {busLabel}</strong>
      </p>
      <p>{route?.route_name}</p>
      <EtaPanel tripId={tripId} pin={pin} />
      <div className="inline-actions">
        <button
          className="button button-outline button-small"
          disabled={locating || busy}
          onClick={locate}
        >
          <Crosshair size={16} />
          {locating ? 'Locating...' : 'Use My Current Location'}
        </button>
        <button
          className="button button-outline button-small"
          disabled={busy}
          onClick={() => {
            version.current++
            setLocating(false)
            document.querySelector<HTMLElement>('.pickup-location-map')?.focus()
            setGpsMessage('Tap the map to place the pin. Drag it or use arrow keys to adjust.')
          }}
        >
          <MapPin size={16} />
          Choose Location on Map
        </button>
      </div>
      <p className="form-help" role="status">
        {gpsMessage}
      </p>
      <PickupMap route={route} pin={pin} onPlace={place} disabled={busy} />
      {pin && (
        <>
          <p className="pickup-coordinates">
            Pickup: {pin[0].toFixed(6)}, {pin[1].toFixed(6)}
          </p>
          <label className="field">
            <span>Pickup address or landmark (optional)</span>
            <input
              maxLength={500}
              value={address}
              disabled={busy}
              onChange={(e) => {
                addressRequest.current?.abort()
                setAddress(e.target.value)
                setConfirmed(false)
              }}
              placeholder="Add a landmark to help the driver"
            />
          </label>
          {!current && <p role="status">Checking route proximity...</p>}
          {current?.error && (
            <Notice tone="error">{current.error} Move the pin to retry the route check.</Notice>
          )}
          {current?.result && (
            <Notice tone={current.result.can_request ? 'info' : 'error'}>
              {current.result.verification === 'unverified'
                ? 'No stored road geometry is available. This location is not verified against the bus route; the driver must review it.'
                : current.result.verification === 'too_far'
                  ? 'Move the pin within 500 metres of the stored bus road path.'
                  : `${current.result.distance_m} m from the stored ${current.result.verification === 'near_reviewed_route' ? 'operator-reviewed' : 'suggested, unapproved'} road path. Proximity does not establish a safe or legal stop.`}
            </Notice>
          )}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirm this pickup pin and selected bus. The driver may reject an unsafe or
            prohibited stop or a full bus.
          </label>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <p className="form-help">
        Choosing a pin uses it to calculate road travel time. Confirming saves the pickup request
        for you and your assigned driver. Your movements are not tracked. View responses in{' '}
        <Link to="/requests">My requests</Link>.
      </p>
      <div className="modal-actions">
        <button className="button button-outline" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button
          className="button button-primary"
          disabled={busy || !pin || !confirmed || !current?.result?.can_request}
          onClick={() => void submit()}
        >
          {busy ? 'Sending...' : 'Request Pickup'}
        </button>
      </div>
    </div>
  )
}
