import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.resetModules()
})
const result = {
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [120.596, 13.2233] },
      properties: { name: 'TEST Terminal', city: 'TEST Town', country: 'Philippines' },
    },
  ],
}
it('searches Photon globally with location bias and caches without a database lookup', async () => {
  vi.stubEnv('VITE_GEOCODING_URL', 'https://photon.example.test')
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result })
  vi.stubGlobal('fetch', fetch)
  const { searchLocations } = await import('./geocoding')
  const found = await searchLocations('  new terminal ')
  expect(found[0]).toMatchObject({
    label: 'TEST Terminal, TEST Town, Philippines',
    lat: 13.2233,
    lng: 120.596,
  })
  const url = new URL(String(fetch.mock.calls[0][0]))
  expect(url.pathname).toBe('/api/')
  expect(url.searchParams.get('q')).toBe('new terminal')
  expect(url.searchParams.has('bbox')).toBe(false)
  await searchLocations('new terminal')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not send short queries or autocomplete to public Nominatim', async () => {
  vi.stubEnv('VITE_GEOCODING_URL', 'https://nominatim.openstreetmap.org')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { searchLocations } = await import('./geocoding')
  expect(await searchLocations('ab')).toEqual([])
  await expect(searchLocations('terminal')).rejects.toThrow('Nominatim autocomplete')
  expect(fetch).not.toHaveBeenCalled()
})
it('ignores malformed coordinates and missing labels instead of generating addresses', async () => {
  const { photonLocations } = await import('./geocoding')
  expect(
    photonLocations({
      features: [
        null,
        { geometry: { type: 'Point', coordinates: [120, 999] }, properties: { name: 'Bad' } },
        { geometry: { type: 'Point', coordinates: [120, 13] }, properties: {} },
      ],
    }),
  ).toEqual([])
})
it('reverse geocoding returns an actual nearby label without changing chosen coordinates', async () => {
  vi.stubEnv('VITE_GEOCODING_URL', 'https://photon.example.test')
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result })
  vi.stubGlobal('fetch', fetch)
  const { reverseLocation } = await import('./geocoding')
  expect(await reverseLocation(13.2234, 120.5961)).toBe('TEST Terminal, TEST Town, Philippines')
  const url = new URL(String(fetch.mock.calls[0][0]))
  expect(url.pathname).toBe('/reverse')
  expect(url.searchParams.get('lat')).toBe('13.2234')
  expect(url.searchParams.get('lon')).toBe('120.5961')
})
it('backs off after provider rate limiting', async () => {
  vi.stubEnv('VITE_GEOCODING_URL', 'https://photon.example.test')
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 })
  vi.stubGlobal('fetch', fetch)
  const { searchLocations } = await import('./geocoding')
  await expect(searchLocations('first location')).rejects.toThrow('busy')
  await expect(searchLocations('different location')).rejects.toThrow('busy')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('cancels obsolete searches before sending a provider request', async () => {
  vi.stubEnv('VITE_GEOCODING_URL', 'https://photon.example.test')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { searchLocations } = await import('./geocoding'),
    controller = new AbortController()
  controller.abort()
  await expect(searchLocations('obsolete query', controller.signal)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
