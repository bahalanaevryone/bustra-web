import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BusFront,
  Users,
  CalendarDays,
  Route as RouteIcon,
  MapPin,
  LayoutDashboard,
  Radio,
  LogOut,
  Plus,
  Minus,
  Search,
  Pencil,
  Trash2,
  Menu,
  X,
  RefreshCw,
  Check,
  Navigation,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { useOperations } from '../hooks/useOperations'
import { useData } from '../hooks/useData'
import { useLocationSharing } from '../hooks/useLocationSharing'
import { Brand, Empty, Loading, Modal, Notice, Status } from '../components/ui'
import { BusMap } from '../features/map/BusMap'
import { EntityEditor, entityNames } from '../features/admin/EntityEditor'
import type { RecordData } from '../features/admin/EntityEditor'
import type { Entity } from '../types'
import { rpc } from '../lib/supabase/client'
import { date, errorMessage, time } from '../lib/utils'

const adminTabs: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'profiles', label: 'Users', icon: Users },
  { key: 'buses', label: 'Buses', icon: BusFront },
  { key: 'trips', label: 'Schedules', icon: CalendarDays },
  { key: 'routes', label: 'Routes', icon: RouteIcon },
  { key: 'pickup_points', label: 'Pickup points', icon: MapPin },
]
const employeeTabs = [
  adminTabs[0],
  { key: 'map', label: 'Live map', icon: MapPin },
  adminTabs[3],
  adminTabs[2],
  adminTabs[5],
]
export function Dashboard({ kind }: { kind: 'admin' | 'employee' }) {
  const admin = kind === 'admin'
  const { user, profile, logout } = useAuth()
  const { data, loading, error: loadError, refresh } = useOperations()
  const { feed, demo, setDemo, refresh: refreshFeed } = useData()
  const [params, setParams] = useSearchParams()
  const tabs = admin ? adminTabs : employeeTabs
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'overview'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [editor, setEditor] = useState<{ entity: Entity; record?: RecordData }>()
  const [deleting, setDeleting] = useState<{ entity: Entity; id: string }>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const selectedTrip =
    data.trips.find((t) => t.id === selected) ||
    data.trips.find((t) => t.driver_id === user?.id && t.status === 'active')
  const bus = data.buses.find((b) => b.id === selectedTrip?.bus_id)
  const canOperate =
    !admin && selectedTrip?.driver_id === user?.id && selectedTrip?.status === 'active'
  const gps = useLocationSharing(selectedTrip?.id, canOperate)
  const requests = data.pickup_requests.filter(
    (r) => r.trip_id === selectedTrip?.id && r.status === 'pending',
  )
  async function reload() {
    await Promise.all([refresh(), refreshFeed()])
  }
  async function action(name: string, args: Record<string, unknown>, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await rpc(name, args)
      setMessage(success)
      await reload()
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  function changeTab(key: string) {
    setParams(key === 'overview' ? {} : { tab: key })
    setQuery('')
    setMobileOpen(false)
  }
  const tableEntity = (tab === 'overview' ? (admin ? 'profiles' : 'trips') : tab) as Entity
  const rows =
    tableEntity in data
      ? (data[tableEntity] as unknown as RecordData[]).filter(
          (r) =>
            JSON.stringify(r).toLowerCase().includes(query.toLowerCase()) &&
            (tableEntity !== 'profiles' || !roleFilter || r.role === roleFilter),
        )
      : []
  function labelFor(key: string, value: unknown) {
    if (key === 'route_id') return data.routes.find((r) => r.id === value)?.route_name || '—'
    if (key === 'bus_id') return data.buses.find((b) => b.id === value)?.plate_number || '—'
    if (key === 'driver_id') {
      const p = data.profiles.find((p) => p.id === value)
      return p ? `${p.first_name} ${p.last_name}` : 'Unassigned'
    }
    if (key === 'departure_at') return `${date(String(value))}, ${time(String(value))} PHT`
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    return String(value ?? '—')
  }
  const columns: Record<Entity, [string, string][]> = {
    profiles: [
      ['first_name', 'First name'],
      ['last_name', 'Last name'],
      ['role', 'Access'],
    ],
    buses: [
      ['plate_number', 'Plate number'],
      ['capacity', 'Capacity'],
    ],
    routes: [
      ['route_name', 'Route'],
      ['origin', 'Origin'],
      ['destination', 'Destination'],
    ],
    pickup_points: [
      ['name', 'Pickup point'],
      ['route_id', 'Route'],
      ['is_active', 'Active'],
    ],
    trips: [
      ['departure_at', 'Departure'],
      ['route_id', 'Route'],
      ['bus_id', 'Bus'],
      ['driver_id', 'Employee'],
      ['status', 'Status'],
    ],
  }
  const editable = admin || tableEntity === 'trips'
  return (
    <div className="dashboard-layout">
      <a className="skip-link" href="#dashboard-main">
        Skip to content
      </a>
      <aside className={`dashboard-sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <Brand light />
        <span className="sidebar-label">OPERATIONS WORKSPACE</span>
        <nav aria-label="Dashboard navigation">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => changeTab(t.key)}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/">
            <Navigation size={17} /> Public website
          </Link>
          <div className="sidebar-user">
            <span className="avatar">
              {profile?.first_name.charAt(0)}
              {profile?.last_name.charAt(0)}
            </span>
            <span>
              <strong>
                {profile?.first_name} {profile?.last_name}
              </strong>
              <small>{admin ? 'Administrator' : 'Employee'}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Log out"
              onClick={() => {
                gps.stop()
                void logout().catch((e) => setError(errorMessage(e)))
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-header">
          <div>
            <button
              className="icon-button menu-toggle"
              aria-label="Toggle dashboard navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X /> : <Menu />}
            </button>
            <span className="breadcrumb">
              BUSTRA <span>/</span> {tabs.find((t) => t.key === tab)?.label}
            </span>
          </div>
          <span className="dashboard-header-location">
            <MapPin size={14} /> Mamburao, PH
          </span>
        </header>
        <main id="dashboard-main" className="dashboard-main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">{admin ? 'SYSTEM OVERVIEW' : 'YOUR DAILY OPERATIONS'}</span>
              <h1>
                {tab === 'overview'
                  ? `${admin ? 'Admin' : 'Employee'} dashboard`
                  : tabs.find((t) => t.key === tab)?.label}
              </h1>
              <p>
                {admin
                  ? 'Manage your people, fleet, routes, and schedules.'
                  : 'Manage schedules, share your assigned trip’s location, and respond to pickups safely.'}
              </p>
            </div>
            <button
              className="button button-outline button-small"
              onClick={() => {
                void reload()
              }}
            >
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
          {demo && (
            <Notice>
              Public demo mode is active. Switch to real service data to see the operations map.{' '}
              <button className="text-button" onClick={() => setDemo(false)}>
                Use service data
              </button>
            </Notice>
          )}
          {(error || loadError) && <Notice tone="error">{error || loadError}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          {(tab === 'overview' || tab === 'map') && (
            <>
              <div className="dashboard-overview">
                <section className="card dashboard-map">
                  <div className="card-heading">
                    <h2>
                      <MapPin size={18} /> Real-time map
                    </h2>
                    <span className="subtle-pill">
                      {data.trips.filter((t) => t.status === 'active').length} active trips
                    </span>
                  </div>
                  <BusMap
                    waitingRequests={data.pickup_requests}
                    feed={
                      demo
                        ? {
                            buses: data.buses,
                            routes: data.routes,
                            pickup_points: data.pickup_points,
                            trips: data.trips,
                            locations: [],
                          }
                        : feed
                    }
                    selected={selectedTrip?.id}
                    onSelect={setSelected}
                  />
                </section>
                {admin ? (
                  <div className="stats-stack">
                    {[
                      {
                        icon: Users,
                        value: data.profiles.length,
                        label: 'Registered users',
                        key: 'profiles',
                      },
                      {
                        icon: BusFront,
                        value: data.buses.length,
                        label: 'Buses in the fleet',
                        key: 'buses',
                      },
                      {
                        icon: CalendarDays,
                        value: data.trips.filter(
                          (t) => !['completed', 'cancelled'].includes(t.status),
                        ).length,
                        label: 'Upcoming & active trips',
                        key: 'trips',
                      },
                    ].map((s) => (
                      <button
                        className="card stat-card"
                        key={s.key}
                        onClick={() => changeTab(s.key)}
                      >
                        <span>
                          <s.icon size={21} />
                        </span>
                        <div>
                          <strong>{s.value}</strong>
                          <small>{s.label}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <section className="card bus-control">
                      <div className="card-heading">
                        <h2>
                          <BusFront size={18} /> Bus control
                        </h2>
                      </div>
                      <div className="control-content">
                        <label className="field">
                          <span>Select a trip</span>
                          <select
                            aria-label="Select bus and trip"
                            value={selectedTrip?.id || ''}
                            onChange={(e) => setSelected(e.target.value)}
                          >
                            <option value="">Choose a bus / active trip</option>
                            {data.trips
                              .filter((t) => !['completed', 'cancelled'].includes(t.status))
                              .map((t) => (
                                <option value={t.id} key={t.id}>
                                  {data.buses.find((b) => b.id === t.bus_id)?.plate_number} ·{' '}
                                  {date(t.departure_at)} {time(t.departure_at)}
                                </option>
                              ))}
                          </select>
                        </label>
                        <strong>{bus?.plate_number || 'No bus selected'}</strong>
                        <p>
                          {data.routes.find((r) => r.id === selectedTrip?.route_id)?.route_name ||
                            'Select a trip to see its controls.'}
                        </p>
                        {selectedTrip && <Status value={selectedTrip.status} />}
                        <button
                          className="button button-primary full-width"
                          disabled={!canOperate || gps.sharing}
                          onClick={gps.start}
                        >
                          <Radio size={16} /> Start sharing location
                        </button>
                        <button
                          className="button button-stop full-width"
                          disabled={!gps.sharing}
                          onClick={gps.stop}
                        >
                          Stop sharing
                        </button>
                        <p className="form-help" role="status">
                          {gps.status}
                          {gps.lastUpdate && ` Last sent ${time(gps.lastUpdate)}.`}
                        </p>
                        <p className="form-help">
                          Keep this page active. GPS may pause when the browser is backgrounded or
                          locked.
                        </p>
                        {!canOperate && (
                          <p className="form-help">
                            Only the assigned employee can operate an active trip.
                          </p>
                        )}
                      </div>
                    </section>
                    <section className="card passenger-card">
                      <div className="card-heading">
                        <h2>
                          <Users size={18} /> Passengers
                        </h2>
                      </div>
                      <div className="passenger-count">
                        {selectedTrip?.onboard_count ?? 0}
                        <small>of {bus?.capacity ?? '—'} capacity</small>
                      </div>
                      <div className="counter-actions">
                        <button
                          className="button button-outline"
                          aria-label="Subtract one passenger"
                          disabled={!canOperate || busy || !selectedTrip?.onboard_count}
                          onClick={() => {
                            void action(
                              'adjust_passengers',
                              { p_trip: selectedTrip?.id, p_delta: -1 },
                              'Passenger count updated.',
                            )
                          }}
                        >
                          <Minus />
                        </button>
                        <button
                          className="button button-primary"
                          aria-label="Add one passenger"
                          disabled={
                            !canOperate ||
                            busy ||
                            (selectedTrip?.onboard_count ?? 0) >= (bus?.capacity ?? 0)
                          }
                          onClick={() => {
                            void action(
                              'adjust_passengers',
                              { p_trip: selectedTrip?.id, p_delta: 1 },
                              'Passenger count updated.',
                            )
                          }}
                        >
                          <Plus />
                        </button>
                      </div>
                      <p className="availability">
                        {bus ? bus.capacity - (selectedTrip?.onboard_count ?? 0) : '—'} spaces
                        available
                      </p>
                    </section>
                  </>
                )}
              </div>
              {!admin && (
                <section className="card request-queue">
                  <div className="card-heading">
                    <h2>
                      <MapPin size={18} /> Incoming pickup requests
                    </h2>
                    <span className="count-pill">{requests.length}</span>
                  </div>
                  {requests.length ? (
                    requests.map((r) => (
                      <div className="queue-row" key={r.id}>
                        <div>
                          <strong>
                            {data.pickup_points.find((p) => p.id === r.pickup_point_id)?.name ||
                              'Pickup point'}
                          </strong>
                          <small>
                            {time(r.requested_at)} · Request {r.id.slice(0, 8)}
                          </small>
                        </div>
                        <div className="inline-actions">
                          <button
                            className="button button-outline button-small"
                            disabled={!canOperate || busy}
                            onClick={() => {
                              void action(
                                'respond_pickup',
                                { p_request: r.id, p_status: 'rejected' },
                                'Request rejected.',
                              )
                            }}
                          >
                            Reject
                          </button>
                          <button
                            className="button button-primary button-small"
                            disabled={!canOperate || busy}
                            onClick={() => {
                              void action(
                                'respond_pickup',
                                { p_request: r.id, p_status: 'accepted' },
                                'Request accepted. Passenger count is unchanged.',
                              )
                            }}
                          >
                            <Check size={15} />
                            Accept
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty title="No pending requests">
                      Select your assigned trip. Respond only when it is safe to do so.
                    </Empty>
                  )}
                </section>
              )}
            </>
          )}
          {tab !== 'map' && (
            <section className="card management-card">
              <div className="card-heading">
                <h2>
                  {tableEntity === 'profiles'
                    ? 'User management'
                    : tableEntity === 'trips'
                      ? 'Schedule management'
                      : tabs.find((t) => t.key === tableEntity)?.label}
                </h2>
                {editable && tableEntity !== 'profiles' && (
                  <button
                    className="button button-primary button-small"
                    onClick={() => setEditor({ entity: tableEntity })}
                  >
                    <Plus size={16} /> Add {entityNames[tableEntity]}
                  </button>
                )}
              </div>
              <div className="table-toolbar">
                <div className="bus-search">
                  <Search size={16} />
                  <input
                    aria-label="Search management records"
                    value={query}
                    placeholder={`Search ${tableEntity.replace('_', ' ')}…`}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {tableEntity === 'profiles' && (
                  <select
                    aria-label="Filter users by role"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="">All roles</option>
                    <option value="user">User</option>
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
              </div>
              {loading ? (
                <Loading />
              ) : rows.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {columns[tableEntity].map(([key, label]) => (
                          <th key={key}>{label}</th>
                        ))}
                        {editable && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={String(row.id)}>
                          {columns[tableEntity].map(([key]) => (
                            <td key={key}>
                              {['status', 'role'].includes(key) ? (
                                <Status value={String(row[key])} />
                              ) : (
                                labelFor(key, row[key])
                              )}
                            </td>
                          ))}
                          {editable && (
                            <td>
                              <div className="inline-actions">
                                <button
                                  className="icon-button"
                                  aria-label={`Edit ${entityNames[tableEntity]} ${String(row.plate_number || row.first_name || row.route_name || row.name || row.id)}`}
                                  disabled={
                                    tableEntity === 'trips' &&
                                    ['completed', 'cancelled'].includes(String(row.status))
                                  }
                                  onClick={() => setEditor({ entity: tableEntity, record: row })}
                                >
                                  <Pencil size={16} />
                                </button>
                                {admin && tableEntity !== 'profiles' && (
                                  <button
                                    className="icon-button danger-text"
                                    aria-label={`Delete ${entityNames[tableEntity]} ${String(row.plate_number || row.route_name || row.name || row.id)}`}
                                    onClick={() =>
                                      setDeleting({ entity: tableEntity, id: String(row.id) })
                                    }
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title={query ? 'No matching records' : 'No records yet'}>
                  {editable
                    ? 'Add a record to get started, or clear your search.'
                    : 'Configured records will appear here.'}
                </Empty>
              )}
              <p className="panel-footnote">
                Showing {rows.length} records · Up to 1,000 per category.{' '}
                {tableEntity === 'profiles'
                  ? 'New accounts use public registration. Account deletion is handled through trusted Supabase Auth administration.'
                  : 'Times are displayed in Philippine time. Referenced records are protected from deletion.'}
              </p>
            </section>
          )}
        </main>
        <footer className="dashboard-footer">
          BUSTRA · Operations workspace <span>AI arrival prediction: planned / not trained</span>
        </footer>
      </div>
      {editor && (
        <EntityEditor
          entity={editor.entity}
          record={editor.record}
          data={data}
          onClose={() => setEditor(undefined)}
          onSaved={async () => {
            await reload()
            setMessage('Record saved.')
          }}
        />
      )}
      {deleting && (
        <Modal
          title={`Delete this ${entityNames[deleting.entity]}?`}
          onClose={() => setDeleting(undefined)}
        >
          <p>
            This permanently removes the record. Records referenced by other data cannot be deleted.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="modal-actions">
            <button className="button button-outline" onClick={() => setDeleting(undefined)}>
              Keep record
            </button>
            <button
              className="button button-danger"
              disabled={busy}
              onClick={() => {
                void action(
                  'admin_delete',
                  { p_entity: deleting.entity, p_id: deleting.id },
                  'Record deleted.',
                ).then((ok) => {
                  if (ok) setDeleting(undefined)
                })
              }}
            >
              {busy ? 'Deleting…' : 'Delete record'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
