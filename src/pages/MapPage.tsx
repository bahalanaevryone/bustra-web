import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BusFront, Search, MapPin } from 'lucide-react'
import { BusMap } from '../features/map/BusMap'
import { useData } from '../hooks/useData'
import { BusDetails } from '../features/buses/BusDetails'
import { Empty, Status } from '../components/ui'
import { ConnectionNotice } from './Home'
import { locationAge } from '../lib/utils'
import { liveMapFeed } from '../features/map/liveMap'
export function MapPage() {
  const { feed: sourceFeed, loading, error, demo, waitingRequests } = useData()
  const feed = liveMapFeed(sourceFeed)
  const [params, setParams] = useSearchParams()
  const selected = params.get('trip') || undefined
  const [routeFilter, setRoute] = useState('')
  const route = feed.routes.some((r) => r.id === routeFilter) ? routeFilter : ''
  const [query, setQuery] = useState('')
  const selectedActive = feed.trips.some((trip) => trip.id === selected)
  useEffect(() => {
    if (!loading && !error && routeFilter && !route) setRoute('')
  }, [loading, error, routeFilter, route])
  useEffect(() => {
    if (!loading && !error && selected && !selectedActive) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.delete('trip')
          next.delete('pickup')
          return next
        },
        { replace: true },
      )
    }
  }, [loading, error, selected, selectedActive, setParams])
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
          <p>Find an active bus and choose your pickup position.</p>
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
          waitingRequests={waitingRequests}
          selectedRoute={route || undefined}
          feed={{
            ...feed,
            trips,
            locations: feed.locations.filter((l) => trips.some((t) => t.id === l.trip_id)),
          }}
          selected={selected}
          onSelect={(id) => setParams({ trip: id })}
          demo={demo}
          large
        />
      </div>
      {selected && selectedActive && (
        <BusDetails
          key={selected}
          tripId={selected}
          initialPickup={params.get('pickup') === '1'}
          onClose={() => setParams({})}
        />
      )}
    </div>
  )
}
