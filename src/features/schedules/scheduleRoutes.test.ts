import { describe, it, expect } from 'vitest'
import { registeredPlaces, generatedRouteName } from './scheduleRoutes'
import { getRouteGuides, validPickupPoints } from '../map/routeGeometry'
import { demoFeed } from '../../lib/demo'
describe('automatic schedule routes', () => {
  it('generates readable names and offers registered places without case/spacing duplicates', () => {
    const feed = demoFeed()
    feed.pickup_points.push({
      ...feed.pickup_points[0],
      id: 'copy',
      name: ' illustrative  terminal ',
    })
    const places = registeredPlaces(feed.routes, feed.pickup_points)
    expect(places.filter((p) => p.toLowerCase() === 'illustrative terminal')).toHaveLength(1)
    expect(generatedRouteName('  Mamburao  ', ' San   Jose ')).toBe('Mamburao → San Jose')
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
