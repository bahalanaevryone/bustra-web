import type { PublicFeed } from '../../types'

// Live maps use operating trips, not the saved route catalog or departure date.
// Schedule editors and operator route previews keep using their full route data.
export function liveMapFeed(feed: PublicFeed): PublicFeed {
  const trips = feed.trips.filter((trip) => trip.status === 'active')
  const tripIds = new Set(trips.map((trip) => trip.id))
  const routeIds = new Set(trips.map((trip) => trip.route_id))
  return {
    ...feed,
    trips,
    routes: feed.routes.filter((route) => routeIds.has(route.id)),
    locations: feed.locations.filter((location) => tripIds.has(location.trip_id)),
  }
}
