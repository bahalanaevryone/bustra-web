import { useState } from 'react'
import type { Entity } from '../../types'
import type { Operations } from '../../hooks/useOperations'
import { Modal, Notice } from '../../components/ui'
import { rpc } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'
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
            required={name !== 'driver_id'}
            disabled={locked || (name === 'role' && record?.role === 'admin')}
          >
            <option value="">{name === 'driver_id' ? 'Unassigned' : 'Choose…'}</option>
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
        await rpc('manage_trip', { p_id: record?.id || null, p_data: values })
      } else {
        if (entity === 'pickup_points') values.is_active = values.is_active === 'on'
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
            {field('route_name', 'Route name')}
            {field('origin', 'Origin')}
            {field('destination', 'Destination')}
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
            {field(
              'bus_id',
              'Bus',
              'text',
              data.buses.map((b) => ({
                value: b.id,
                label: `${b.plate_number} · ${b.capacity} capacity`,
              })),
            )}
            {field(
              'route_id',
              'Route',
              'text',
              data.routes.map((r) => ({ value: r.id, label: r.route_name })),
            )}
            {field(
              'driver_id',
              'Assigned employee',
              'text',
              data.profiles
                .filter((p) => p.role === 'employee')
                .map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}` })),
            )}
            {field('departure_at', 'Departure (your device’s local time)', 'datetime-local')}
            {field(
              'status',
              'Trip status',
              'text',
              ['scheduled', 'active', 'delayed', 'completed', 'cancelled'].map((v) => ({
                value: v,
                label: v.charAt(0).toUpperCase() + v.slice(1),
              })),
            )}
            <p className="form-help">
              An active trip’s assignment is locked. Finish or cancel it before changing its bus or
              employee. Finished trips are retained as history.
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
