export type Role = 'user' | 'employee' | 'admin'
export type TripStatus = 'scheduled' | 'active' | 'completed' | 'cancelled' | 'delayed'
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired'
export interface Profile {
  id: string
  first_name: string
  last_name: string
  role: Role
  created_at: string
}
export interface Bus {
  id: string
  plate_number: string
  capacity: number
}
export interface Route {
  id: string
  route_name: string
  origin: string
  destination: string
}
export interface PickupPoint {
  id: string
  route_id: string
  name: string
  latitude: number
  longitude: number
  stop_order: number
  is_active: boolean
}
export interface Trip {
  id: string
  bus_id: string
  route_id: string
  departure_at: string
  onboard_count: number
  status: TripStatus
  driver_id?: string | null
  created_by?: string
}
export interface BusLocation {
  trip_id: string
  latitude: number
  longitude: number
  updated_at: string
  speed_kmh?: number
  accuracy_m?: number
}
export interface PickupRequest {
  id: string
  trip_id: string
  user_id: string
  pickup_point_id: string
  status: RequestStatus
  requested_at: string
  responded_at?: string
}
export interface PublicFeed {
  buses: Bus[]
  routes: Route[]
  pickup_points: PickupPoint[]
  trips: Trip[]
  locations: BusLocation[]
}
export type Entity = 'profiles' | 'buses' | 'routes' | 'pickup_points' | 'trips'
