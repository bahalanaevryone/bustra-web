import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})
it('does not contact a routing provider when none is configured', async () => {
  vi.stubEnv('VITE_ROUTING_URL', '')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { requestRoadRoute, routingConfigured } = await import('./roadRouting')
  expect(routingConfigured()).toBe(false)
  await expect(
    requestRoadRoute([
      [13.22, 120.59],
      [13.23, 120.6],
    ]),
  ).rejects.toThrow('not configured')
  expect(fetch).not.toHaveBeenCalled()
})
it('uses the configured provider and caches correctly ordered road coordinates', async () => {
  vi.stubEnv('VITE_ROUTING_URL', 'https://routing.example.test')
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      code: 'Ok',
      routes: [
        {
          geometry: {
            coordinates: [
              [120.59, 13.22],
              [120.595, 13.225],
              [120.6, 13.23],
            ],
          },
          distance: 1500,
          duration: 200,
        },
      ],
    }),
  })
  vi.stubGlobal('fetch', fetch)
  const { requestRoadRoute } = await import('./roadRouting')
  const points: [number, number][] = [
    [13.22, 120.59],
    [13.23, 120.6],
  ]
  const route = await requestRoadRoute(points)
  expect(route.coordinates).toEqual([
    [13.22, 120.59],
    [13.225, 120.595],
    [13.23, 120.6],
  ])
  expect(String(fetch.mock.calls[0][0])).toContain('/route/v1/driving/120.59,13.22;120.6,13.23?')
  await requestRoadRoute(points)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('rejects a provider result that does not reach the selected endpoints', async () => {
  vi.stubEnv('VITE_ROUTING_URL', 'https://routing.example.test')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            geometry: {
              coordinates: [
                [121, 14],
                [122, 15],
              ],
            },
          },
        ],
      }),
    }),
  )
  const { requestRoadRoute } = await import('./roadRouting')
  await expect(
    requestRoadRoute([
      [13.22, 120.59],
      [13.23, 120.6],
    ]),
  ).rejects.toThrow('does not match')
})
