import { describe, expect, it } from 'vitest'
import { demoFeed } from '../../lib/demo'
import {
  distanceKm,
  escapeHtml,
  farFromRoute,
  getRouteGuides,
  validCoordinate,
} from './routeGeometry'
describe('map route and request geometry', () => {
  it('uses confirmed endpoints, and focuses the selected trip', () => {
    const feed = demoFeed()
    const guides = getRouteGuides(feed, 'demo-trip-1')
    expect(guides).toHaveLength(1)
    expect(guides[0].ordered).toBe(true)
    expect(guides[0].coordinates).toEqual([
      [13.2233, 120.596],
      [13.237, 120.601],
    ])
  })
  it('does not invent a route when an endpoint is absent or data is missing', () => {
    const feed = demoFeed()
    feed.routes[0].destination_lat = undefined
    expect(getRouteGuides(feed, 'demo-trip-1')[0].coordinates).toEqual([])
    expect(getRouteGuides(feed, undefined, 'demo-route-2')[0].ordered).toBe(false)
  })
  it('recognizes a wrong-longitude position far from the configured route', () => {
    const route = getRouteGuides(demoFeed(), 'demo-trip-1')[0]
    expect(farFromRoute([13.2233, 13.2235], route)).toBe(true)
    expect(farFromRoute([13.2233, 120.596], route)).toBe(false)
    expect(distanceKm([13.2233, 120.596], [13.2233, 120.596])).toBe(0)
  })
  it('retains actual suggested geometry without labelling it approved', () => {
    const feed = demoFeed()
    feed.routes[0].road_path = [[13.2233, 120.596], [13.23, 120.599], [13.237, 120.601]]
    const guide = getRouteGuides(feed, 'demo-trip-1')[0]
    expect(guide.roadPath).toEqual(feed.routes[0].road_path)
    expect(guide.approved).toBe(false)
  })
  it('rejects invalid coordinates and escapes labels inserted into Leaflet HTML', () => {
    expect(validCoordinate(13.22, 120.59)).toBe(true)
    expect(validCoordinate(undefined, 120)).toBe(false)
    expect(validCoordinate(91, 120)).toBe(false)
    expect(escapeHtml('<img onerror="bad">')).toBe('&lt;img onerror=&quot;bad&quot;&gt;')
  })
})
