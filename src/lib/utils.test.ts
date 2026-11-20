import { describe, expect, it } from 'vitest'
import { getBasicEta, isFresh, registrationSchema, safeReturn } from './utils'
describe('public and account boundaries', () => {
  it('validates the five signup fields and strips untrusted role input', () => {
    const signup = registrationSchema.parse({
      first_name: ' Ana ',
      last_name: 'Reyes',
      email: 'ana@example.com',
      password: 'safe-password',
      confirm: 'safe-password',
      role: 'admin',
    })
    expect(signup.first_name).toBe('Ana')
    expect(signup).not.toHaveProperty('role')
  })
  it('rejects mismatched passwords and empty names', () => {
    expect(
      registrationSchema.safeParse({
        first_name: '',
        last_name: 'R',
        email: 'a@example.com',
        password: 'long-password',
        confirm: 'different',
      }).success,
    ).toBe(false)
  })
  it('accepts only intended local pickup destinations', () => {
    expect(safeReturn('/map?trip=abc&point=def')).toBe('/map?trip=abc&point=def')
    for (const path of [
      'https://evil.example',
      '//evil.example',
      '/admin',
      '/map\\evil',
      '/mapanything',
    ])
      expect(safeReturn(path)).toBeNull()
  })
  it('marks missing, old, invalid and future GPS as stale', () => {
    const now = Date.parse('2026-11-20T00:00:00Z')
    expect(isFresh('2026-11-19T23:59:20Z', now)).toBe(true)
    for (const timestamp of [undefined, 'invalid', '2026-11-19T23:00:00Z', '2026-11-20T01:00:00Z'])
      expect(isFresh(timestamp, now)).toBe(false)
  })
  it('requires valid road distance and speed for a non-AI estimate', () => {
    expect(getBasicEta(10, 30)).toBe(20)
    expect(getBasicEta(0, 30)).toBe(0)
    expect(getBasicEta()).toBeNull()
    expect(getBasicEta(10, 0)).toBeNull()
    expect(getBasicEta(-1, 30)).toBeNull()
    expect(getBasicEta(10, 150)).toBeNull()
  })
})
