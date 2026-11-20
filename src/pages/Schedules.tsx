import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useData } from '../hooks/useData'
import { Empty, Loading, Status } from '../components/ui'
import { date, time } from '../lib/utils'
import { BusDetails } from '../features/buses/BusDetails'
import { ConnectionNotice } from './Home'
export function Schedules() {
  const { feed, loading } = useData()
  const [route, setRoute] = useState('')
  const [day, setDay] = useState('')
  const [selected, setSelected] = useState<string>()
  const trips = feed.trips
    .filter(
      (t) =>
        (!route || t.route_id === route) &&
        (!day ||
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(
            new Date(t.departure_at),
          ) === day),
    )
    .sort((a, b) => a.departure_at.localeCompare(b.departure_at))
  return (
    <div className="container page-space">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE TIME FOR YOUR DAY</span>
          <h1>Bus schedules</h1>
          <p>Explore published departures and find a route that works for you.</p>
        </div>
        <CalendarDays size={34} className="page-icon" />
      </div>
      <ConnectionNotice />
      <div className="card">
        <div className="table-toolbar">
          <label className="field">
            <span>Route</span>
            <select value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="">All routes</option>
              {feed.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.route_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Departure date (Philippine time)</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <button
            className="button button-outline"
            onClick={() => {
              setRoute('')
              setDay('')
            }}
          >
            Clear filters
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : trips.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Departure</th>
                  <th>Route</th>
                  <th>Bus</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{time(t.departure_at)}</strong>
                      <small>{date(t.departure_at)} · PHT</small>
                    </td>
                    <td>{feed.routes.find((r) => r.id === t.route_id)?.route_name}</td>
                    <td>{feed.buses.find((b) => b.id === t.bus_id)?.plate_number}</td>
                    <td>
                      <Status value={t.status} />
                    </td>
                    <td>
                      <button className="text-button" onClick={() => setSelected(t.id)}>
                        View trip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No departures found">
            Schedules will appear after an operator publishes them. Try clearing your filters.
          </Empty>
        )}
        <p className="panel-footnote">
          Departure times may change. A pickup request is subject to driver confirmation.
        </p>
      </div>
      {selected && <BusDetails tripId={selected} onClose={() => setSelected(undefined)} />}
    </div>
  )
}
