import { useState } from 'react'
import type { Entity } from '../../types'
import type { Operations } from '../../hooks/useOperations'
import { Modal, Notice } from '../../components/ui'
import { rpc } from '../../lib/supabase/client'
import { errorMessage } from '../../lib/utils'
import { ScheduleEditor } from '../schedules/ScheduleEditor'
import { RouteReview } from './RouteReview'
import type { Coordinate } from '../map/routeGeometry'
import { UserEditor } from './UserEditor'
export const entityNames: Record<Entity, string> = {
  profiles: 'user',
  buses: 'bus',
  routes: 'route',
  trips: 'schedule',
}
export type RecordData = Record<string, string | number | boolean | null | undefined>
export function EntityEditor(props: Parameters<typeof RecordEditor>[0]) {
  if (props.entity === 'profiles') {
    const profile = props.data.profiles.find((p) => p.id === props.record?.id)
    return profile ? (
      <UserEditor profile={profile} onClose={props.onClose} onSaved={props.onSaved} />
    ) : (
      <Modal title="Account unavailable" onClose={props.onClose}>
        <Notice tone="error">Refresh User Management and select an existing account.</Notice>
      </Modal>
    )
  }
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
          <select name={name} defaultValue={String(value)} required>
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
      if (entity === 'routes') {
        values.is_approved = values.is_approved === 'on'
        values.road_path = roadPath
      }
      await rpc('admin_save', { p_entity: entity, p_id: record?.id || null, p_data: values })
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
              Review the actual road path before approving this route for bus service. Passenger
              pins still require driver review.
            </p>
            <RouteReview
              route={data.routes.find((r) => r.id === record?.id)}
              path={roadPath}
              onPath={setRoadPath}
            />
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
