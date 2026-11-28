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
  origin_lat?: number | null
  origin_lng?: number | null
  destination_lat?: number | null
  destination_lng?: number | null
  origin_latitude?: number | null
  origin_longitude?: number | null
  destination_latitude?: number | null
  destination_longitude?: number | null
  is_approved?: boolean
  road_path?: [number, number][] | null
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
  course_degrees?: number | null
}
export interface PickupRequest {
  id: string
  trip_id: string
  user_id: string
  pickup_latitude: number
  pickup_longitude: number
  pickup_address?: string | null
  route_verification?: 'near_reviewed_route' | 'near_suggested_route' | 'unverified'
  route_distance_m?: number | null
  response_note?: string | null
  status: RequestStatus
  requested_at: string
  responded_at?: string
}
export type MapRequest = Pick<
  PickupRequest,
  | 'id'
  | 'trip_id'
  | 'pickup_latitude'
  | 'pickup_longitude'
  | 'pickup_address'
  | 'status'
  | 'requested_at'
>
export interface PublicFeed {
  buses: Bus[]
  routes: Route[]
  trips: Trip[]
  locations: BusLocation[]
}
export type Entity = 'profiles' | 'buses' | 'routes' | 'trips'
