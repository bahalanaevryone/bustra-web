import { z } from 'zod'
export const registrationSchema = z
  .object({
    first_name: z.string().trim().min(1, 'Enter your first name.').max(80),
    last_name: z.string().trim().min(1, 'Enter your last name.').max(80),
    email: z.email('Enter a valid email address.'),
    password: z.string().min(8, 'Use at least 8 characters.').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match.',
    path: ['confirm'],
  })
export function safeReturn(value: string | null): string | null {
  return value && /^\/(map|requests)(\?|$)/.test(value) && !value.includes('\\') ? value : null
}
export function isFresh(timestamp?: string, now = Date.now()) {
  if (!timestamp) return false
  const age = now - Date.parse(timestamp)
  return Number.isFinite(age) && age >= -10000 && age <= 90000
}
export function locationAge(timestamp?: string) {
  if (!timestamp) return 'Location not shared'
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000))
  return seconds < 60 ? 'Updated just now' : `Updated ${Math.floor(seconds / 60)} min ago`
}
export function getBasicEta(roadDistanceKm?: number, speedKmh?: number): number | null {
  if (
    !Number.isFinite(roadDistanceKm) ||
    !Number.isFinite(speedKmh) ||
    roadDistanceKm! < 0 ||
    speedKmh! < 5 ||
    speedKmh! > 120
  )
    return null
  return Math.ceil((roadDistanceKm! / speedKmh!) * 60)
}
export const time = (value: string) =>
  new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))
export const date = (value: string) =>
  new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : 'Something went wrong. Please try again.'
}
export const emptyFeed = { buses: [], routes: [], trips: [], locations: [] }
