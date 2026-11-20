import { describe, expect, it } from 'vitest'
import { demoFeed } from '../../lib/demo'
import {
  distanceKm,
  escapeHtml,
  farFromRoute,
  getRouteGuides,
  getWaitingAtStop,
  validCoordinate,
} from './routeGeometry'
import type { PickupRequest } from '../../types'
describe('map route and request geometry', () => {
  it('orders route stops, derives endpoints, and focuses the selected trip', () => {
    const feed = demoFeed()
    feed.pickup_points.reverse()
    const guides = getRouteGuides(feed, 'demo-trip-1')
    expect(guides).toHaveLength(1)
    expect(guides[0].ordered).toBe(true)
    expect(guides[0].coordinates).toEqual([
      [13.2233, 120.596],
      [13.237, 120.601],
    ])
    expect(guides[0].stops[0].id).toBe('demo-point-1')
  })
  it('does not invent a route when stop ordering is ambiguous or data is missing', () => {
    const feed = demoFeed()
    feed.pickup_points[1].stop_order = 1
    expect(getRouteGuides(feed, 'demo-trip-1')[0].coordinates).toEqual([])
    expect(getRouteGuides(feed, undefined, 'demo-route-2')[0].ordered).toBe(false)
  })
  it('counts only pending/accepted requests on active trips at the specified stop', () => {
    const feed = demoFeed()
    const requests = ['pending', 'accepted', 'cancelled', 'rejected'].map((status, i) => ({
      id: String(i),
      trip_id: 'demo-trip-1',
      pickup_point_id: 'demo-point-1',
      status,
    })) as PickupRequest[]
    requests.push({
      id: 'scheduled',
      trip_id: 'demo-trip-3',
      pickup_point_id: 'demo-point-1',
      status: 'pending',
    } as PickupRequest)
    expect(getWaitingAtStop(requests, feed, 'demo-point-1')).toEqual({ pending: 1, accepted: 1 })
    expect(getWaitingAtStop(requests, feed, 'demo-point-2')).toEqual({ pending: 0, accepted: 0 })
  })
  it('recognizes a wrong-longitude position far from the configured route', () => {
    const route = getRouteGuides(demoFeed(), 'demo-trip-1')[0]
    expect(farFromRoute([13.2233, 13.2235], route)).toBe(true)
    expect(farFromRoute([13.2233, 120.596], route)).toBe(false)
    expect(distanceKm([13.2233, 120.596], [13.2233, 120.596])).toBe(0)
  })
  it('rejects invalid coordinates and escapes labels inserted into Leaflet HTML', () => {
    expect(validCoordinate(13.22, 120.59)).toBe(true)
    expect(validCoordinate(undefined, 120)).toBe(false)
    expect(validCoordinate(91, 120)).toBe(false)
    expect(escapeHtml('<img onerror="bad">')).toBe('&lt;img onerror=&quot;bad&quot;&gt;')
  })
})
