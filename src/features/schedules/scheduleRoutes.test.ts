import { describe, it, expect } from 'vitest'
import {
  generatedRouteName,
  matchingRoute,
  validLocation,
  endpointLocation,
} from './scheduleRoutes'
import { getRouteGuides, validPickupPoints } from '../map/routeGeometry'
import { demoFeed } from '../../lib/demo'
describe('automatic schedule routes', () => {
  it('generates readable names without requiring registered database places', () => {
    const feed = demoFeed()
    feed.pickup_points.push({
      ...feed.pickup_points[0],
      id: 'copy',
      name: ' illustrative  terminal ',
    })
    expect(generatedRouteName('  Mamburao  ', ' San   Jose ')).toBe('Mamburao → San Jose')
    expect(
      validLocation({
        label: 'Custom roadside landmark',
        lat: 13.22,
        lng: 120.59,
        source: 'custom',
      }),
    ).toBe(true)
    expect(validLocation({ label: 'No position', lat: NaN, lng: 120.59, source: 'custom' })).toBe(
      false,
    )
  })
  it('requires matching normalized labels and nearby coordinates, not a route name alone', () => {
    const feed = demoFeed(),
      route = feed.routes[0]
    Object.assign(route, {
      origin_lat: 13.2233,
      origin_lng: 120.596,
      destination_lat: 13.237,
      destination_lng: 120.601,
    })
    const a = endpointLocation(route, 'origin')!,
      b = endpointLocation(route, 'destination')!
    expect(
      matchingRoute(
        feed.routes,
        { ...a, label: ' illustrative   TERMINAL ', lat: a.lat + 0.0001 },
        b,
      )?.id,
    ).toBe(route.id)
    expect(matchingRoute(feed.routes, { ...a, lat: a.lat + 0.01 }, b)).toBeUndefined()
    expect(matchingRoute(feed.routes, b, a)).toBeUndefined()
    expect(matchingRoute(feed.routes, { ...a, label: 'Different place' }, b)).toBeUndefined()
  })
  it('uses endpoint coordinates for new routes without inventing pickup stops', () => {
    const feed = demoFeed()
    feed.pickup_points = []
    Object.assign(feed.routes[0], {
      origin_latitude: 13.2233,
      origin_longitude: 120.596,
      destination_latitude: 13.237,
      destination_longitude: 120.601,
    })
    const guide = getRouteGuides(feed, 'demo-trip-1')[0]
    expect(guide.ordered).toBe(true)
    expect(guide.stops).toHaveLength(0)
    expect(guide.approved).toBe(false)
    expect(validPickupPoints(feed.routes[0], feed.pickup_points)).toEqual([])
  })
  it('restricts pickup choices to active same-route stops near a reviewed road path', () => {
    const feed = demoFeed(),
      route = feed.routes[0]
    expect(validPickupPoints(route, feed.pickup_points)).toEqual([])
    route.is_approved = true
    route.road_path = [
      [13.2233, 120.596],
      [13.237, 120.601],
    ]
    feed.pickup_points.push({ ...feed.pickup_points[0], id: 'off-road', latitude: 14 })
    feed.pickup_points.push({ ...feed.pickup_points[0], id: 'inactive', is_active: false })
    expect(validPickupPoints(route, feed.pickup_points).map((p) => p.id)).toEqual([
      'demo-point-1',
      'demo-point-2',
    ])
    expect(getRouteGuides(feed, 'demo-trip-1')[0].roadPath).toEqual(route.road_path)
  })
})
