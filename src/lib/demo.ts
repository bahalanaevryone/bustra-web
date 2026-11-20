import type { PublicFeed } from '../types'
// Illustrative fixtures, never presented as real bus positions or operator schedules.
export function demoFeed(): PublicFeed {
  const day = new Date().toISOString().slice(0, 10)
  return {
    buses: [
      { id: 'demo-bus-1', plate_number: 'DEMO 001', capacity: 40 },
      { id: 'demo-bus-2', plate_number: 'DEMO 002', capacity: 36 },
      { id: 'demo-bus-3', plate_number: 'DEMO 003', capacity: 40 },
    ],
    routes: [
      {
        id: 'demo-route-1',
        route_name: 'DEMO · Mamburao local loop',
        origin: 'Illustrative terminal',
        origin_lat: 13.2233, origin_lng: 120.596, destination_lat: 13.237, destination_lng: 120.601,
        destination: 'Illustrative north stop',
      },
      {
        id: 'demo-route-2',
        route_name: 'DEMO · Coastal connector',
        origin: 'Illustrative central stop',
        destination: 'Illustrative coastal stop',
      },
    ],
    trips: [
      {
        id: 'demo-trip-1',
        bus_id: 'demo-bus-1',
        route_id: 'demo-route-1',
        departure_at: `${day}T00:00:00Z`,
        onboard_count: 24,
        status: 'active',
      },
      {
        id: 'demo-trip-2',
        bus_id: 'demo-bus-2',
        route_id: 'demo-route-2',
        departure_at: `${day}T02:30:00Z`,
        onboard_count: 12,
        status: 'active',
      },
      {
        id: 'demo-trip-3',
        bus_id: 'demo-bus-3',
        route_id: 'demo-route-1',
        departure_at: `${day}T06:00:00Z`,
        onboard_count: 0,
        status: 'scheduled',
      },
    ],
    locations: [
      {
        trip_id: 'demo-trip-1',
        latitude: 13.229,
        longitude: 120.598,
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        trip_id: 'demo-trip-2',
        latitude: 13.2165,
        longitude: 120.591,
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  }
}
