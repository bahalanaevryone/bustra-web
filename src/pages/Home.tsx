import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BusFront,
  CalendarDays,
  MapPin,
  Radio,
  Search,
  ShieldCheck,
  Navigation,
  Clock,
  ChevronRight,
  Route as RouteIcon,
  RefreshCw,
} from 'lucide-react'
import { useData } from '../hooks/useData'
import { BusMap } from '../features/map/BusMap'
import { BusDetails } from '../features/buses/BusDetails'
import { BusIllustration } from '../components/BusIllustration'
import { Empty, Loading, Notice, Status } from '../components/ui'
import { date, isFresh, time } from '../lib/utils'

export function ConnectionNotice() {
  const { error, demo, setDemo, refresh } = useData()
  if (!error || demo) return null
  return (
    <Notice>
      <div className="connection-notice">
        <div>
          <strong>Service data is currently unavailable.</strong>
          <p>
            The database may still need setup, or the connection may be offline. You can explore a
            clearly labelled demo.
          </p>
        </div>
        <div className="inline-actions">
          <button
            className="button button-outline button-small"
            onClick={() => {
              void refresh()
            }}
          >
            <RefreshCw size={14} /> Retry
          </button>
          <button className="button button-primary button-small" onClick={() => setDemo(true)}>
            Explore demo
          </button>
        </div>
      </div>
    </Notice>
  )
}
export function Home() {
  const { feed, loading, demo, lastSync } = useData()
  const [selected, setSelected] = useState<string>()
  const [search, setSearch] = useState('')
  const [routeId, setRouteId] = useState('')
  const active = feed.trips.filter((t) => t.status === 'active')
  const filtered = active.filter(
    (t) =>
      (!routeId || t.route_id === routeId) &&
      `${feed.buses.find((b) => b.id === t.bus_id)?.plate_number} ${feed.routes.find((r) => r.id === t.route_id)?.route_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const now = Date.now()
  const upcoming = feed.trips
    .filter(
      (t) =>
        ['scheduled', 'delayed', 'active'].includes(t.status) &&
        (demo || Date.parse(t.departure_at) > now - 86400000),
    )
    .sort((a, b) => a.departure_at.localeCompare(b.departure_at))
    .slice(0, 4)
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">
              <span /> MADE FOR YOUR EVERYDAY JOURNEY
            </span>
            <h1>
              Know where your bus is.
              <br />
              <em>Get there with confidence.</em>
            </h1>
            <p>
              Follow buses, check schedules, and request a pickup.
              <br className="desktop-break" /> A little less waiting. A better way to travel.
            </p>
            <div className="hero-actions">
              <Link to="/map" className="button button-primary">
                <MapPin size={18} /> Explore live map
              </Link>
              <Link to="/schedules" className="button button-white">
                <CalendarDays size={18} /> View schedules
              </Link>
            </div>
            <span className="hero-note">
              <ShieldCheck size={15} /> No account needed to explore. Always free to view.
            </span>
          </div>
          <div className="hero-art">
            <BusIllustration />
            <span className="hero-art-caption">
              <span className="caption-icon">
                <Navigation size={18} />
              </span>
              <span>
                <strong>A more connected commute</strong>
                <small>Mamburao, Occidental Mindoro</small>
              </span>
            </span>
          </div>
        </div>
      </section>
      <div className="container">
        <div className="feature-strip">
          <div>
            <Radio />
            <span>
              <strong>Follow the journey</strong>
              <small>See the latest shared bus locations</small>
            </span>
          </div>
          <div>
            <CalendarDays />
            <span>
              <strong>Plan your day</strong>
              <small>Find routes and departure times</small>
            </span>
          </div>
          <div>
            <MapPin />
            <span>
              <strong>Request a pickup</strong>
              <small>Let your driver know you’re waiting</small>
            </span>
          </div>
        </div>
        <section className="home-service">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR COMMUTE AT A GLANCE</span>
              <h2>Let’s get you moving.</h2>
              <p>Find your bus and see what’s happening along the way.</p>
            </div>
            <span className="region-label">
              <MapPin size={16} /> Mamburao, PH
            </span>
          </div>
          <ConnectionNotice />
          <div className="service-grid">
            <section className="card map-card">
              <div className="card-heading">
                <h3>
                  <MapPin size={18} /> Live bus map
                </h3>
                <span className="subtle-pill">
                  {demo
                    ? 'Demo view'
                    : `${feed.locations.filter((l) => isFresh(l.updated_at)).length} sharing now`}
                </span>
              </div>
              <BusMap
                feed={
                  routeId
                    ? {
                        ...feed,
                        trips: feed.trips.filter((t) => t.route_id === routeId),
                        locations: feed.locations.filter((l) =>
                          feed.trips.some((t) => t.id === l.trip_id && t.route_id === routeId),
                        ),
                        pickup_points: feed.pickup_points.filter((p) => p.route_id === routeId),
                      }
                    : feed
                }
                selected={selected}
                onSelect={setSelected}
                demo={demo}
              />
              <div className="map-card-footer">
                <span>
                  <i className="legend-dot" />
                  Bus location <i className="legend-stop" />
                  Pickup point
                </span>
                <Link to="/map">
                  Open full map <ChevronRight size={15} />
                </Link>
              </div>
            </section>
            <section className="card buses-card">
              <div className="card-heading">
                <h3>
                  <BusFront size={18} /> Buses on the road
                </h3>
                <span className="count-pill">{active.length}</span>
              </div>
              <div className="bus-search">
                <Search size={16} />
                <input
                  aria-label="Search active buses"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search a bus or route…"
                />
              </div>
              <div className="bus-list">
                {loading ? (
                  <Loading />
                ) : filtered.length ? (
                  filtered.slice(0, 3).map((t) => {
                    const bus = feed.buses.find((b) => b.id === t.bus_id)
                    const route = feed.routes.find((r) => r.id === t.route_id)
                    return (
                      <button className="bus-row" key={t.id} onClick={() => setSelected(t.id)}>
                        <span className="bus-row-icon">
                          <BusFront size={21} />
                        </span>
                        <span className="bus-row-copy">
                          <span>
                            <strong>{bus?.plate_number}</strong>
                            <Status value={t.status} />
                          </span>
                          <small>{route?.route_name}</small>
                          <span className="bus-spaces">
                            {(bus?.capacity ?? 0) - t.onboard_count} reported spaces available
                          </span>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    )
                  })
                ) : (
                  <Empty title={search || routeId ? 'No matching buses' : 'No buses on route'}>
                    Active services will appear here when available.
                  </Empty>
                )}
              </div>
              <Link to="/map" className="card-bottom-link">
                View all buses <ChevronRight size={15} />
              </Link>
            </section>
            <section className="card schedules-card">
              <div className="card-heading">
                <h3>
                  <CalendarDays size={18} /> Upcoming departures
                </h3>
              </div>
              <div className="schedule-list">
                {loading ? (
                  <Loading />
                ) : upcoming.length ? (
                  upcoming.map((t) => (
                    <button className="schedule-row" key={t.id} onClick={() => setSelected(t.id)}>
                      <span className="schedule-time">
                        {time(t.departure_at)}
                        <small>{date(t.departure_at)}</small>
                      </span>
                      <span>
                        <strong>{feed.routes.find((r) => r.id === t.route_id)?.route_name}</strong>
                        <small>{feed.buses.find((b) => b.id === t.bus_id)?.plate_number}</small>
                      </span>
                      <Status value={t.status} />
                    </button>
                  ))
                ) : (
                  <Empty title="No scheduled departures">
                    Check back when the operator publishes a schedule.
                  </Empty>
                )}
              </div>
              <Link to="/schedules" className="card-bottom-link">
                Full schedule <ChevronRight size={15} />
              </Link>
            </section>
          </div>
          <div className="service-bottom">
            <span>
              <Clock size={14} />
              {demo
                ? 'Demo data · not an operating service'
                : lastSync
                  ? `Service data checked at ${time(lastSync)}`
                  : 'Waiting for service data'}
            </span>
            <label>
              Route{' '}
              <select
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                aria-label="Filter home map and buses by route"
              >
                <option value="">All routes</option>
                {feed.routes.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.route_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>
      <section className="how-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">A SIMPLER WAY TO TRAVEL</span>
              <h2>Your next ride, in three steps.</h2>
            </div>
            <Link to="/about" className="text-link">
              Get to know BUSTRA <ChevronRight size={16} />
            </Link>
          </div>
          <div className="how-grid">
            <article>
              <span className="how-icon">
                <MapPin />
              </span>
              <h3>Find your bus</h3>
              <p>Explore the map and choose a bus travelling along your route.</p>
            </article>
            <article>
              <span className="how-icon">
                <RouteIcon />
              </span>
              <h3>Choose your pickup point</h3>
              <p>Sign in, select a designated stop, and send your pickup request.</p>
            </article>
            <article>
              <span className="how-icon">
                <BusFront />
              </span>
              <h3>Wait for confirmation</h3>
              <p>Check your request status and head to your pickup point safely.</p>
            </article>
          </div>
        </div>
      </section>
      <section className="container">
        <div className="join-banner">
          <div>
            <h2>A smoother journey starts here.</h2>
            <p>Create an account to request pickups and keep track of your requests.</p>
          </div>
          <Link to="/register" className="button button-white">
            Create a free account
          </Link>
        </div>
      </section>
      {selected && <BusDetails tripId={selected} onClose={() => setSelected(undefined)} />}
    </>
  )
}
