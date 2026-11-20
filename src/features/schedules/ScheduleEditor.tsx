import { useEffect, useMemo, useRef, useState } from 'react'
import { Route as RouteIcon, MapPin, LoaderCircle, Check } from 'lucide-react'
import type { Operations } from '../../hooks/useOperations'
import type { RecordData } from '../admin/EntityEditor'
import { Modal, Notice } from '../../components/ui'
import { rpc } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'
import { distanceKm, getRouteGuides } from '../map/routeGeometry'
import type { Coordinate } from '../map/routeGeometry'
import { requestRoadRoute, routingConfigured } from '../map/roadRouting'
import {
  endpointLocation,
  generatedRouteName,
  matchingRoute,
  validLocation,
} from './scheduleRoutes'
import type { SelectedLocation } from './scheduleRoutes'
import { reverseLocation } from './geocoding'
import { LocationSearch } from './LocationSearch'
import { ScheduleMap } from './ScheduleMap'
import type { Endpoint } from './ScheduleMap'
import '../../styles/schedule.css'

type Preview = {
  key: string
  phase: 'waiting' | 'loading' | 'ready' | 'unavailable' | 'approved'
  path: Coordinate[] | null
  message: string
}
export function ScheduleEditor({
  record,
  data,
  onClose,
  onSaved,
}: {
  record?: RecordData
  data: Operations
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const route = data.routes.find((r) => r.id === record?.route_id)
  const [origin, setOrigin] = useState(() => endpointLocation(route, 'origin')),
    [destination, setDestination] = useState(() => endpointLocation(route, 'destination'))
  const [active, setActive] = useState<Endpoint | null>(null),
    [busId, setBusId] = useState(String(record?.bus_id || '')),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [statuses, setStatuses] = useState({ origin: '', destination: '' })
  const reverse = useRef<Record<Endpoint, AbortController | null>>({
    origin: null,
    destination: null,
  })
  const timers = useRef<Record<Endpoint, ReturnType<typeof setTimeout> | null>>({
    origin: null,
    destination: null,
  })
  const mapPanel = useRef<HTMLElement>(null)
  const locked = record?.status === 'active'
  const bus = data.buses.find((b) => b.id === busId)
  const match = useMemo(
    () => matchingRoute(data.routes, origin, destination),
    [data.routes, origin, destination],
  )
  const guide = match
    ? getRouteGuides({
        routes: [match],
        pickup_points: data.pickup_points,
        trips: [],
        buses: [],
        locations: [],
      })[0]
    : undefined
  const reviewed = guide?.approved && guide.roadPath ? guide.roadPath : null
  const valid =
    validLocation(origin) &&
    validLocation(destination) &&
    distanceKm([origin.lat, origin.lng], [destination.lat, destination.lng]) >= 0.005
  const previewKey = JSON.stringify([origin, destination, match?.id, reviewed, guide?.coordinates])
  const [preview, setPreview] = useState<Preview>({
    key: '',
    phase: 'waiting',
    path: null,
    message: '',
  })
  const current =
    preview.key === previewKey
      ? preview
      : ({
          key: previewKey,
          phase: valid ? 'loading' : 'waiting',
          path: null,
          message: '',
        } as Preview)
  useEffect(
    () => () => {
      for (const k of ['origin', 'destination'] as const) {
        reverse.current[k]?.abort()
        if (timers.current[k]) clearTimeout(timers.current[k])
      }
    },
    [],
  )
  useEffect(() => {
    let disposed = false
    setConfirmed(false)
    if (!valid) {
      setPreview({
        key: previewKey,
        phase: 'waiting',
        path: null,
        message: 'Select and label both positions to preview the route.',
      })
      return
    }
    if (reviewed) {
      setPreview({
        key: previewKey,
        phase: 'approved',
        path: reviewed,
        message: 'Existing operator-reviewed bus path. Designated pickup rules remain in effect.',
      })
      return
    }
    if (!routingConfigured()) {
      setPreview({
        key: previewKey,
        phase: 'unavailable',
        path: null,
        message:
          'Road routing is not configured. You can confirm these positions and save a schedule pending route review.',
      })
      return
    }
    setPreview({
      key: previewKey,
      phase: 'loading',
      path: null,
      message: 'Finding an available road path…',
    })
    const timer = setTimeout(() => {
      const a = origin!,
        b = destination!
      const points = guide?.ordered
        ? ([
            [a.lat, a.lng],
            ...guide.stops.map((p) => [Number(p.latitude), Number(p.longitude)]),
            [b.lat, b.lng],
          ] as Coordinate[])
        : ([
            [a.lat, a.lng],
            [b.lat, b.lng],
          ] as Coordinate[])
      const distinct = points.filter((p, i) => !i || distanceKm(points[i - 1], p) > 0.001)
      void requestRoadRoute(distinct)
        .then((road) => {
          if (!disposed)
            setPreview({
              key: previewKey,
              phase: 'ready',
              path: road.coordinates,
              message: 'Suggested road path. It is not an approved bus route.',
            })
        })
        .catch(() => {
          if (!disposed)
            setPreview({
              key: previewKey,
              phase: 'unavailable',
              path: null,
              message:
                'No road route is available for these locations right now. You may save the confirmed positions pending operator review.',
            })
        })
    }, 800)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [previewKey])
  function update(kind: Endpoint, value: SelectedLocation | null) {
    reverse.current[kind]?.abort()
    if (timers.current[kind]) clearTimeout(timers.current[kind])
    setConfirmed(false)
    setStatuses((s) => ({ ...s, [kind]: '' }))
    ;(kind === 'origin' ? setOrigin : setDestination)(value)
  }
  function place(kind: Endpoint, position: Coordinate) {
    if (locked) return
    setActive(null)
    reverse.current[kind]?.abort()
    if (timers.current[kind]) clearTimeout(timers.current[kind])
    const controller = new AbortController()
    reverse.current[kind] = controller
    const old = kind === 'origin' ? origin : destination,
      label = old?.source === 'custom' ? old.label : ''
    const p: SelectedLocation = {
      label,
      lat: Number(position[0].toFixed(6)),
      lng: Number(position[1].toFixed(6)),
      source: label ? 'custom' : 'map',
    }
    ;(kind === 'origin' ? setOrigin : setDestination)(p)
    setConfirmed(false)
    setStatuses((s) => ({ ...s, [kind]: 'Looking up a nearby address…' }))
    timers.current[kind] = setTimeout(() => {
      void reverseLocation(p.lat, p.lng, controller.signal)
        .then((address) => {
          if (controller.signal.aborted) return
          if (address && !label)
            (kind === 'origin' ? setOrigin : setDestination)({ ...p, label: address })
          setStatuses((s) => ({
            ...s,
            [kind]: address
              ? label
                ? `Nearby address: ${address}`
                : 'Address found. Verify the pin and label before confirming.'
              : 'No nearby address found. Enter a custom label; these coordinates are preserved.',
          }))
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setStatuses((s) => ({
              ...s,
              [kind]:
                'Address lookup is unavailable. Enter a custom label; these coordinates are preserved.',
            }))
        })
    }, 650)
  }
  const initialDeparture = (() => {
    if (!record?.departure_at) return ''
    const d = new Date(String(record.departure_at))
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })()
  async function save(form: HTMLFormElement) {
    if (!valid || !confirmed || locked) {
      setError('Select, verify and confirm both locations before saving.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const fields = Object.fromEntries(new FormData(form))
      const values = {
        bus_id: busId,
        driver_id: String(fields.driver_id),
        departure_at:
          record?.departure_at && String(fields.departure_at) === initialDeparture
            ? String(record.departure_at)
            : new Date(String(fields.departure_at)).toISOString(),
        initial_passenger_count: record
          ? Number(record.onboard_count)
          : Number(fields.initial_passenger_count),
        status: record?.status || 'scheduled',
        origin: origin!.label.trim(),
        destination: destination!.label.trim(),
        origin_lat: origin!.lat,
        origin_lng: origin!.lng,
        destination_lat: destination!.lat,
        destination_lng: destination!.lng,
        locations_confirmed: true,
      }
      if (
        !bus ||
        !Number.isInteger(values.initial_passenger_count) ||
        values.initial_passenger_count < 0 ||
        values.initial_passenger_count > bus.capacity
      )
        throw new Error(
          'Initial passenger count must be a whole number within the assigned bus capacity.',
        )
      await rpc('manage_trip', { p_id: record?.id || null, p_data: values })
      await onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={record ? 'Edit schedule' : 'Add schedule'}
      onClose={onClose}
      className="schedule-modal"
    >
      <p className="schedule-intro">
        Choose your journey’s endpoints by address or directly on the map.
      </p>
      {locked && (
        <Notice tone="info">
          This active trip’s assignment is locked. Use the schedule table to complete or cancel it.
        </Notice>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(e.currentTarget)
        }}
        onChange={(e) => {
          if ((e.target as unknown as HTMLInputElement).name !== 'locations_confirmed')
            setConfirmed(false)
        }}
      >
        <div className="schedule-layout">
          <section className="schedule-locations" aria-label="Journey locations">
            <LocationSearch
              name="Origin"
              value={origin}
              onChange={(p) => update('origin', p)}
              disabled={locked}
              status={statuses.origin}
              onChooseMap={() => {
                setActive('origin')
                setConfirmed(false)
                mapPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }}
            />
            <LocationSearch
              name="Destination"
              value={destination}
              onChange={(p) => update('destination', p)}
              disabled={locked}
              status={statuses.destination}
              onChooseMap={() => {
                setActive('destination')
                setConfirmed(false)
                mapPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }}
            />
            <small className="geocoding-credit">
              Address search:{' '}
              <a href="https://github.com/komoot/photon" target="_blank" rel="noreferrer">
                Photon
              </a>{' '}
              ·{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                © OpenStreetMap contributors
              </a>
            </small>
          </section>
          <section className="schedule-preview" ref={mapPanel} aria-label="Review journey">
            <div className="schedule-preview-heading">
              <RouteIcon size={18} />
              <h3>Route preview</h3>
              {current.phase === 'loading' && <LoaderCircle className="spin" size={17} />}
            </div>
            <ScheduleMap
              origin={origin}
              destination={destination}
              path={current.path}
              approved={current.phase === 'approved'}
              stops={guide?.stops || []}
              active={active}
              onPlace={place}
              disabled={locked}
            />
            <div className="schedule-pin-legend">
              <span>
                <b>A</b> Origin
              </span>
              <span>
                <b>B</b> Destination
              </span>
              {active && (
                <button type="button" className="text-button" onClick={() => setActive(null)}>
                  Done choosing
                </button>
              )}
            </div>
            <p className="form-help">
              Tap to place a pin after choosing its field. Drag a pin to adjust it, or focus a pin
              and use the arrow keys.
            </p>
            <div className="schedule-route-name">
              <MapPin size={17} />
              <div>
                <small>Generated route name</small>
                <strong>
                  {origin?.label && destination?.label
                    ? generatedRouteName(origin.label, destination.label)
                    : 'Select origin and destination'}
                </strong>
              </div>
            </div>
            <p
              className={`schedule-route-status ${current.phase === 'unavailable' ? 'route-unavailable' : ''}`}
              role="status"
            >
              {current.message || 'Select both locations to see an available road path.'}
            </p>
            {current.phase === 'ready' && (
              <small className="geocoding-credit">
                Road directions: OSRM · © OpenStreetMap contributors
              </small>
            )}
            <p className="form-help">
              {match
                ? 'Matching route and its designated stops will be reused when the server validates the positions.'
                : 'New routes remain pending operator review. Pickup points are never created automatically.'}
            </p>
          </section>
          <section className="schedule-assignment" aria-label="Trip assignment">
            <label className="field">
              <span>Assigned Bus</span>
              <select
                name="bus_id"
                value={busId}
                required
                disabled={locked}
                onChange={(e) => setBusId(e.target.value)}
              >
                <option value="">Choose bus</option>
                {data.buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.plate_number} · {b.capacity} capacity
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Assigned Driver</span>
              <select
                name="driver_id"
                required
                disabled={locked}
                defaultValue={String(record?.driver_id || '')}
              >
                <option value="">Choose driver</option>
                {data.profiles
                  .filter((p) => p.role === 'employee')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Departure Date and Time</span>
              <input
                name="departure_at"
                type="datetime-local"
                required
                readOnly={locked}
                defaultValue={initialDeparture}
              />
            </label>
            <label className="field">
              <span>Initial Passenger Count</span>
              <input
                name="initial_passenger_count"
                type="number"
                min={0}
                max={bus?.capacity}
                step={1}
                required
                readOnly={!!record}
                defaultValue={Number(record?.onboard_count || 0)}
              />
            </label>
            <p className="form-help schedule-assignment-help">
              Times use your device’s local time. New schedules start as Scheduled. Later passenger
              counts use the assigned trip’s controls.
            </p>
          </section>
          <div className="schedule-confirmation">
            <label className="checkbox-field">
              <input
                name="locations_confirmed"
                type="checkbox"
                checked={confirmed}
                disabled={!valid || current.phase === 'loading' || locked}
                onChange={(e) => setConfirmed(e.target.checked)}
                required
              />
              <span>I verified both location pins and reviewed the route information above.</span>
            </label>
            <p className="form-help">
              This confirmation does not approve a bus route. Passenger pickups require an
              operator-reviewed path and designated stops.
            </p>
            {origin && destination && !valid && (
              <p className="danger-text">
                Provide labels for both pins and choose positions at least 5 metres apart.
              </p>
            )}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="button button-outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={busy || !valid || !confirmed || current.phase === 'loading' || locked}
          >
            {busy ? (
              <>
                <LoaderCircle size={17} className="spin" />
                Saving…
              </>
            ) : (
              <>
                <Check size={17} />
                Save Schedule
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
