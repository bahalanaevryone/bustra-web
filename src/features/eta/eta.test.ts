import { describe, expect, it } from 'vitest'
import {
  approach,
  assignedRoadPath,
  checkFix,
  estimate,
  features,
  FEATURES,
  metres,
  modelPrediction,
  project,
  roadRoute,
  routeDiagnostics,
} from '../../../supabase/functions/_shared/eta'
import type { Fix, Point } from '../../../supabase/functions/_shared/eta'

const now = Date.parse('2026-11-28T02:00:00Z')
const path: Point[] = [
  [13.2, 120.6],
  [13.21, 120.6],
  [13.22, 120.6],
  [13.23, 120.6],
]
const pin: Point = [13.225, 120.6]
const fix: Fix = {
  latitude: 13.205,
  longitude: 120.6,
  updated_at: new Date(now).toISOString(),
  speed_kmh: 30,
  accuracy_m: 10,
  course_degrees: 0,
}
// Deterministic test fixture, never an accuracy result or a deployed model.
const fixture = {
  schema_version: 1,
  eligible: true,
  algorithm: 'LinearRegression',
  version: 'test-only',
  timezone: 'Asia/Manila',
  features: FEATURES,
  coefficients: [2, 0, 0, 0, 0, 0],
  intercept: 1,
  mean: [0, 0, 0, 0, 0, 0],
  scale: [1, 1, 1, 1, 1, 1],
  minimum: [0, 0, 0, -1, -1, 0],
  maximum: [100, 200, 1, 1, 1, 6],
  metrics: { training_trips: 24, holdout_trips: 6, model_mae_minutes: 1, routing_mae_minutes: 2 },
}
const router = async (p: Point[]) => ({
  coordinates: p,
  distance: metres([fix.latitude, fix.longitude], pin),
  duration: 360,
})

describe('GPS and direction safeguards', () => {
  it('confirms a bus approaching a pickup on its ordered assigned path', () => {
    expect(approach(fix, pin, path).movement).toBe('approaching')
  })
  it('rejects moving away and already passed points', () => {
    expect(() => approach({ ...fix, course_degrees: 180 }, pin, path)).toThrow('moving away')
    expect(() => approach({ ...fix, latitude: 13.229 }, pin, path)).toThrow('already passed')
  })
  it('requires direction evidence and rejects missing, stale, future or inaccurate GPS', () => {
    expect(() => approach({ ...fix, course_degrees: null }, pin, path)).toThrow('confirm')
    for (const f of [
      null,
      { ...fix, latitude: NaN },
      { ...fix, updated_at: new Date(now - 91000).toISOString() },
      { ...fix, updated_at: new Date(now + 11000).toISOString() },
      { ...fix, accuracy_m: 101 },
      { ...fix, accuracy_m: null },
    ])
      expect(() => checkFix(f, now)).toThrow()
  })
  it('rejects a pin off the actual road path and ambiguous overlapping loops', () => {
    expect(() => approach(fix, [13.225, 120.61], path)).toThrow('Your pickup pin is')
    expect(() => project([13.21, 120.6], [...path, ...path.slice().reverse()])).toThrow('loop')
  })
})
describe('route mismatch diagnostics', () => {
  it('distinguishes bus GPS errors from pickup pin errors without widening the corridor', () => {
    const badBus = { ...fix, longitude: 120.602 }
    expect(() => approach(badBus, pin, path)).toThrow('reported bus GPS')
    const diagnostics = routeDiagnostics(badBus, pin, path)
    expect(diagnostics.bus_offset_m).toBeGreaterThan(150)
    expect(diagnostics.pickup_offset_m).toBe(0)
    expect(diagnostics.corridor_limit_m).toBe(150)
  })
  it('refuses reversed/moved endpoint geometry instead of silently replacing it', async () => {
    const route = {
      origin_lat: 13.2,
      origin_lng: 120.6,
      destination_lat: 13.23,
      destination_lng: 120.6,
      road_path: [...path].reverse(),
    }
    await expect(assignedRoadPath(route, router)).rejects.toThrow('does not start/end')
    expect(
      (await assignedRoadPath({ ...route, road_path: path, is_approved: true }, router)).source,
    ).toBe('stored_reviewed')
  })
  it('identifies a generated suggestion when no stored path exists and validates latitude ordering', async () => {
    expect(
      (
        await assignedRoadPath(
          { origin_lat: 13.2, origin_lng: 120.6, destination_lat: 13.23, destination_lng: 120.6 },
          router,
        )
      ).source,
    ).toBe('router_suggestion')
    await expect(
      assignedRoadPath(
        { origin_lat: 120.6, origin_lng: 13.2, destination_lat: 120.6, destination_lng: 13.23 },
        router,
      ),
    ).rejects.toThrow('latitude')
  })
})
describe('road estimates and inference fallback', () => {
  it('uses routing distance and duration with no model', async () => {
    const result = await estimate(fix, pin, path, router, null, now)
    expect(result.source).toBe('approximate')
    expect(result.minutes).toBe(6)
    expect(result.road_distance_m).toBeCloseTo(2223.9, 0)
  })
  it('reports a stopped bus with unknown waiting time', async () => {
    const result = await estimate(
      { ...fix, speed_kmh: 0, course_degrees: null },
      pin,
      path,
      router,
      fixture,
      now,
    )
    expect(result.movement).toBe('stopped')
    expect(result.message).toContain('unknown waiting')
    expect(result.source).toBe('approximate')
  })
  it('uses a valid linear artifact and falls back for missing, malformed or unsuitable models', async () => {
    const result = await estimate(fix, pin, path, router, fixture, now)
    expect(result.source).toBe('ai')
    expect(result.minutes).toBeCloseTo(5.4478, 2)
    for (const model of [
      null,
      { ...fixture, eligible: false },
      { ...fixture, coefficients: [] },
      { ...fixture, scale: [0, 1, 1, 1, 1, 1] },
      { ...fixture, metrics: { ...fixture.metrics, model_mae_minutes: 3 } },
    ])
      expect((await estimate(fix, pin, path, router, model, now)).source).toBe('approximate')
    expect(modelPrediction(fixture, [101, 30, 0, 0, 1, 5])).toBeNull()
  })
  it('does not route a straight shortcut around the assigned bus path', async () => {
    await expect(
      estimate(
        fix,
        pin,
        path,
        async () => ({ coordinates: [[13.21, 120.62], pin], distance: 2200, duration: 100 }),
        null,
        now,
      ),
    ).rejects.toThrow('does not follow')
  })
  it('handles a bus near the pin without claiming a verified arrival', async () => {
    const result = await estimate({ ...fix, latitude: 13.225 }, pin, path, router, null, now)
    expect(result.status).toBe('near_pickup')
    expect(result.road_distance_m).toBeNull()
    expect(result.minutes).toBeNull()
    expect(result.message).toContain('being verified')
  })
  it('handles OSRM no-route, network errors and invalid numeric results', async () => {
    const responses = [
      async () => {
        throw new Error('offline')
      },
      async () => Response.json({ code: 'NoRoute' }),
      async () =>
        Response.json({
          code: 'Ok',
          routes: [
            {
              distance: NaN,
              duration: 20,
              geometry: {
                coordinates: [
                  [120.6, 13.205],
                  [120.6, 13.225],
                ],
              },
            },
          ],
        }),
    ]
    for (const fetcher of responses)
      await expect(
        roadRoute('https://router.example', [path[0], pin], fetcher as typeof fetch),
      ).rejects.toThrow()
  })
  it('keeps provider coordinate order and reads valid OSRM road metrics', async () => {
    let requested = ''
    const response = await roadRoute('https://router.example', [path[0], pin], async (input) => {
      requested = String(input)
      return Response.json({
        code: 'Ok',
        routes: [
          {
            distance: 3000,
            duration: 480,
            geometry: {
              coordinates: [
                [120.6, 13.2],
                [120.6, 13.225],
              ],
            },
          },
        ],
      })
    })
    expect(requested).toContain('120.6,13.2;120.6,13.225')
    expect(response.distance).toBe(3000)
  })
  it('uses Manila time and Monday-zero weekday consistently with Python', () => {
    const x = features(1500, null, '2026-11-27T16:00:00Z')
    expect(x).toEqual([1.5, 0, 1, 0, 1, 5])
  })
})
