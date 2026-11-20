import { describe, expect, it } from 'vitest'
import { demoFeed } from '../../lib/demo'
import { liveMapFeed } from './liveMap'
import { getRouteGuides } from './routeGeometry'

describe('live map trip lifecycle', () => {
  it('excludes finished, cancelled, scheduled and delayed-only routes and their stale locations', () => {
    const feed = demoFeed()
    for (const status of ['completed', 'cancelled', 'scheduled', 'delayed'] as const) {
      const routeId = `route-${status}`,
        tripId = `trip-${status}`
      feed.routes.push({ ...feed.routes[0], id: routeId })
      feed.trips.push({ ...feed.trips[0], id: tripId, route_id: routeId, status })
      feed.locations.push({ ...feed.locations[0], trip_id: tripId })
    }
    const live = liveMapFeed(feed)
    expect(live.trips.map((trip) => trip.id)).toEqual(['demo-trip-1', 'demo-trip-2'])
    expect(live.routes.map((route) => route.id)).toEqual(['demo-route-1', 'demo-route-2'])
    expect(live.locations.map((location) => location.trip_id)).toEqual([
      'demo-trip-1',
      'demo-trip-2',
    ])
  })

  it('keeps an active trip even with an old departure date or outdated GPS report', () => {
    const feed = demoFeed()
    feed.trips[0].departure_at = '2000-01-01T00:00:00Z'
    feed.locations[0].updated_at = '2000-01-01T00:00:00Z'
    const live = liveMapFeed(feed)
    expect(live.trips.some((trip) => trip.id === 'demo-trip-1')).toBe(true)
    expect(live.locations.some((location) => location.trip_id === 'demo-trip-1')).toBe(true)
  })

  it('retains a shared route while any trip on it is active and removes it after the last trip ends', () => {
    const feed = demoFeed()
    feed.trips[0].status = 'completed'
    feed.trips[2].status = 'active'
    expect(liveMapFeed(feed).routes.some((route) => route.id === 'demo-route-1')).toBe(true)
    feed.trips[2].status = 'completed'
    const live = liveMapFeed(feed)
    expect(live.routes.some((route) => route.id === 'demo-route-1')).toBe(false)
    expect(live.locations.some((location) => location.trip_id === 'demo-trip-1')).toBe(false)
  })

  it('draws no route guides when every trip has ended without deleting the route catalog', () => {
    const feed = demoFeed()
    feed.trips.forEach((trip) => {
      trip.status = 'completed'
    })
    const before = JSON.stringify(feed)
    const live = liveMapFeed(feed)
    expect(live.trips).toEqual([])
    expect(live.routes).toEqual([])
    expect(live.locations).toEqual([])
    expect(getRouteGuides(live)).toEqual([])
    expect(JSON.stringify(feed)).toBe(before)
    expect(getRouteGuides({ ...feed, trips: [], locations: [] })).toHaveLength(2)
  })
})
