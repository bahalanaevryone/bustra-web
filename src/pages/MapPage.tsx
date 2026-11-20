import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BusFront, Search, MapPin } from 'lucide-react'
import { BusMap } from '../features/map/BusMap'
import { useData } from '../hooks/useData'
import { BusDetails } from '../features/buses/BusDetails'
import { Empty, Status } from '../components/ui'
import { ConnectionNotice } from './Home'
import { locationAge } from '../lib/utils'
export function MapPage() {
  const { feed, demo } = useData()
  const [params, setParams] = useSearchParams()
  const selected = params.get('trip') || undefined
  const [route, setRoute] = useState('')
  const [query, setQuery] = useState('')
  const trips = feed.trips.filter(
    (t) =>
      t.status === 'active' &&
      (!route || t.route_id === route) &&
      `${feed.buses.find((b) => b.id === t.bus_id)?.plate_number} ${feed.routes.find((r) => r.id === t.route_id)?.route_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  return (
    <div className="container page-space">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FOLLOW YOUR JOURNEY</span>
          <h1>Live bus map</h1>
          <p>Find active buses and designated pickup points.</p>
        </div>
        <span className="region-label">
          <MapPin size={16} /> Mamburao, PH
        </span>
      </div>
      <ConnectionNotice />
      <div className="map-page-grid">
        <aside className="card">
          <div className="card-heading">
            <h3>
              <BusFront size={18} /> Find your bus
            </h3>
          </div>
          <div className="filter-panel">
            <label className="field">
              <span>Route</span>
              <select value={route} onChange={(e) => setRoute(e.target.value)}>
                <option value="">All routes</option>
                {feed.routes.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.route_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="bus-search">
              <Search size={16} />
              <input
                aria-label="Search buses"
                placeholder="Search a plate number…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          {trips.length ? (
            trips.map((t) => (
              <button
                className={`map-bus-card ${selected === t.id ? 'selected' : ''}`}
                key={t.id}
                onClick={() => setParams({ trip: t.id })}
              >
                <span className="row-between">
                  <strong>{feed.buses.find((b) => b.id === t.bus_id)?.plate_number}</strong>
                  <Status value={t.status} />
                </span>
                <span>{feed.routes.find((r) => r.id === t.route_id)?.route_name}</span>
                <small>
                  {demo
                    ? 'Illustrative demo location'
                    : locationAge(feed.locations.find((l) => l.trip_id === t.id)?.updated_at)}
                </small>
              </button>
            ))
          ) : (
            <Empty title="No active buses">Try another route or check back later.</Empty>
          )}
          <p className="panel-footnote">
            Grey markers show outdated positions. Browse without sharing your location.
          </p>
        </aside>
        <BusMap
          feed={{
            ...feed,
            trips,
            locations: feed.locations.filter((l) => trips.some((t) => t.id === l.trip_id)),
            pickup_points: feed.pickup_points.filter((p) => !route || p.route_id === route),
          }}
          selected={selected}
          onSelect={(id) => setParams({ trip: id })}
          demo={demo}
          large
        />
      </div>
      {selected && (
        <BusDetails
          key={selected}
          tripId={selected}
          initialPoint={params.get('point') || ''}
          onClose={() => setParams({})}
        />
      )}
    </div>
  )
}
