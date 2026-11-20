import { useState } from 'react'
import type { Entity } from '../../types'
import type { Operations } from '../../hooks/useOperations'
import { Modal, Notice } from '../../components/ui'
import { rpc } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'
import { ScheduleEditor } from '../schedules/ScheduleEditor'
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
export function EntityEditor(props: Parameters<typeof RecordEditor>[0]) {
  return props.entity === 'trips' ? (
    <ScheduleEditor
      record={props.record}
      data={props.data}
      onClose={props.onClose}
      onSaved={props.onSaved}
    />
  ) : (
    <RecordEditor {...props} />
  )
}
function RecordEditor({
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
  const [roadPath, setRoadPath] = useState<Coordinate[] | null>(
    data.routes.find((r) => r.id === record?.id)?.road_path || null,
  )
  function field(
    name: string,
    label: string,
    type = 'text',
    options?: { value: string; label: string }[],
  ) {
    let value = record?.[name]
    if (value == null) value = name === 'stop_order' ? 0 : name === 'status' ? 'scheduled' : ''
    return (
      <label className="field" key={name}>
        <span>{label}</span>
        {options ? (
          <select
            name={name}
            defaultValue={String(value)}
            required
            disabled={name === 'role' && record?.role === 'admin'}
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
            defaultValue={String(value)}
            required
            maxLength={
              type === 'text' ? (['origin', 'destination'].includes(name) ? 500 : 160) : undefined
            }
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
      if (entity === 'pickup_points') values.is_active = values.is_active === 'on'
      if (entity === 'routes') {
        values.is_approved = values.is_approved === 'on'
        values.road_path = roadPath
      }
      await rpc('admin_save', { p_entity: entity, p_id: record?.id || null, p_data: values })
      if (entity === 'profiles' && values.role && values.role !== record?.role)
        await rpc('set_employee_role', { p_user: record?.id, p_role: values.role })
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
              Add at least two verified pickup stops in travel order before approving this bus
              route. Origin and destination pins do not automatically become pickup stops.
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
              Use a different order number for each designated stop: 1 for the first pickup stop,
              then 2, 3 and so on in travel order. Verify that each position is a valid pickup stop
              on the bus route.
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
