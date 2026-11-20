import { useState } from 'react'
import type { Entity } from '../../types'
import type { Operations } from '../../hooks/useOperations'
import { Modal, Notice } from '../../components/ui'
import { rpc } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'
import { generatedRouteName, placeKey, registeredPlaces } from '../schedules/scheduleRoutes'
import { RouteReview } from './RouteReview'
import type { Coordinate } from '../map/routeGeometry'
export const entityNames: Record<Entity, string> = {
  profiles: 'user',
  buses: 'bus',
  routes: 'route',
  pickup_points: 'pickup point',
  trips: 'schedule',
}
export type RecordData = Record<string, string | number | boolean | null | undefined>
export function EntityEditor({
  entity,
  record,
  data,
  onClose,
  onSaved,
}: {
  entity: Entity
  record?: RecordData
  data: Operations
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existingRoute = data.routes.find((r) => r.id === record?.route_id)
  const [origin, setOrigin] = useState(existingRoute?.origin || '')
  const [destination, setDestination] = useState(existingRoute?.destination || '')
  const [busId, setBusId] = useState(String(record?.bus_id || ''))
  const [roadPath, setRoadPath] = useState<Coordinate[] | null>(
    data.routes.find((r) => r.id === record?.id)?.road_path || null,
  )
  const places = registeredPlaces(data.routes, data.pickup_points)
  const selectedBus = data.buses.find((b) => b.id === busId)
  const assignmentLocked = record?.status === 'active'
  function field(
    name: string,
    label: string,
    type = 'text',
    options?: { value: string; label: string }[],
  ) {
    const locked =
      entity === 'trips' &&
      record?.status === 'active' &&
      ['bus_id', 'route_id', 'driver_id', 'departure_at'].includes(name)
    let value = record?.[name]
    if (name === 'departure_at' && value) {
      const instant = new Date(String(value))
      value = new Date(instant.getTime() - instant.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    }
    if (value == null) value = name === 'stop_order' ? 0 : name === 'status' ? 'scheduled' : ''
    return (
      <label className="field" key={name}>
        <span>{label}</span>
        {options ? (
          <select
            name={name}
            defaultValue={String(value)}
            required
            disabled={locked || (name === 'role' && record?.role === 'admin')}
          >
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            name={name}
            type={type}
            readOnly={locked}
            defaultValue={String(value)}
            required
            maxLength={type === 'text' ? 160 : undefined}
            step={
              ['latitude', 'longitude'].includes(name)
                ? '0.000001'
                : type === 'number'
                  ? '1'
                  : undefined
            }
            min={
              name === 'capacity'
                ? 1
                : name === 'stop_order'
                  ? 0
                  : name === 'latitude'
                    ? -90
                    : name === 'longitude'
                      ? -180
                      : undefined
            }
            max={
              name === 'capacity'
                ? 200
                : name === 'latitude'
                  ? 90
                  : name === 'longitude'
                    ? 180
                    : undefined
            }
          />
        )}
      </label>
    )
  }
  async function save(form: HTMLFormElement) {
    setBusy(true)
    setError('')
    try {
      const values: Record<string, unknown> = Object.fromEntries(new FormData(form))
      if (entity === 'trips') {
        // Preserve exact server timestamps and assignments when ending an active trip.
        // datetime-local displays minutes, so it must not rewrite a locked timestamp.
        if (record?.status === 'active') {
          for (const key of ['bus_id', 'route_id', 'driver_id', 'departure_at'])
            values[key] = record[key]
        } else values.departure_at = new Date(String(values.departure_at)).toISOString()
        values.origin = origin
        values.destination = destination
        values.status = record?.status || 'scheduled'
        if (record) values.initial_passenger_count = record.onboard_count
        await rpc('manage_trip', { p_id: record?.id || null, p_data: values })
      } else {
        if (entity === 'pickup_points') values.is_active = values.is_active === 'on'
        if (entity === 'routes') {
          values.is_approved = values.is_approved === 'on'
          values.road_path = roadPath
        }
        await rpc('admin_save', { p_entity: entity, p_id: record?.id || null, p_data: values })
        if (entity === 'profiles' && values.role && values.role !== record?.role)
          await rpc('set_employee_role', { p_user: record?.id, p_role: values.role })
      }
      await onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`${record ? 'Edit' : 'Add'} ${entityNames[entity]}`} onClose={onClose}>
      <form
        onChange={(e) => {
          const target = e.target
          if (
            entity === 'routes' &&
            target instanceof HTMLInputElement &&
            ['origin', 'destination'].includes(target.name)
          )
            setRoadPath(null)
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void save(e.currentTarget)
        }}
      >
        {entity === 'buses' && (
          <>
            {field('plate_number', 'Plate number')}
            {field('capacity', 'Passenger capacity', 'number')}
          </>
        )}
        {entity === 'routes' && (
          <>
            {field('origin', 'Origin')}
            {field('destination', 'Destination')}
            <p className="form-help">
              To draw this route on the map, add at least two active pickup points. The lowest
              stop-order number is the origin and the highest is the destination.
            </p>
            <RouteReview
              route={data.routes.find((r) => r.id === record?.id)}
              points={data.pickup_points}
              path={roadPath}
              onPath={setRoadPath}
            />
          </>
        )}
        {entity === 'pickup_points' && (
          <>
            {field('name', 'Pickup point name')}
            {field(
              'route_id',
              'Route',
              'text',
              data.routes.map((r) => ({ value: r.id, label: r.route_name })),
            )}
            <div className="form-two-col">
              {field('latitude', 'Latitude', 'number')}
              {field('longitude', 'Longitude', 'number')}
            </div>
            {field('stop_order', 'Stop order', 'number')}
            <p className="form-help">
              Use a different order number for each stop on this route: 1 for the origin, 2 for the
              next stop, and the largest number for the destination. Enter verified coordinates for
              the actual stop.
            </p>
            <label className="checkbox-field">
              <input
                name="is_active"
                type="checkbox"
                defaultChecked={record?.is_active !== false}
              />{' '}
              Active pickup point
            </label>
          </>
        )}
        {entity === 'trips' && (
          <>
            <label className="field">
              <span>Origin</span>
              <select
                name="origin"
                value={origin}
                disabled={assignmentLocked}
                required
                onChange={(e) => setOrigin(e.target.value)}
              >
                <option value="">Choose origin</option>
                {places.map((p) => (
                  <option key={p} value={p} disabled={placeKey(p) === placeKey(destination)}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Destination</span>
              <select
                name="destination"
                value={destination}
                disabled={assignmentLocked}
                required
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">Choose destination</option>
                {places.map((p) => (
                  <option key={p} value={p} disabled={placeKey(p) === placeKey(origin)}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <p className="form-help" role="status">
              {origin && destination
                ? `Route: ${generatedRouteName(origin, destination)} · Existing endpoint pairs are reused automatically.`
                : 'Select registered origin and destination locations. The route name is generated automatically.'}
            </p>
            <label className="field">
              <span>Assigned Bus</span>
              <select
                name="bus_id"
                value={busId}
                disabled={assignmentLocked}
                required
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
            {field(
              'driver_id',
              'Assigned Driver',
              'text',
              data.profiles
                .filter((p) => p.role === 'employee')
                .map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}` })),
            )}
            {field('departure_at', 'Departure Date and Time', 'datetime-local')}
            <label className="field">
              <span>Initial Passenger Count</span>
              <input
                name="initial_passenger_count"
                type="number"
                min={0}
                max={selectedBus?.capacity}
                step={1}
                required
                readOnly={!!record}
                defaultValue={Number(record?.onboard_count || 0)}
              />
            </label>
            <p className="form-help">
              Times use your device’s local time. New schedules start as Scheduled. Initial count
              cannot exceed the bus capacity; later changes use the assigned trip passenger
              controls. Newly generated routes require operator approval and valid pickup stops
              before accepting requests.
            </p>
          </>
        )}
        {entity === 'profiles' && (
          <>
            {field('first_name', 'First name')}
            {field('last_name', 'Last name')}
            {field(
              'role',
              'Account access',
              'text',
              (record?.role === 'admin' ? ['admin'] : ['user', 'employee']).map((v) => ({
                value: v,
                label: v,
              })),
            )}
            <p className="form-help">
              The sole admin cannot be demoted. Reassign unfinished trips before demoting an
              employee.
            </p>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          <button className="button button-outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
