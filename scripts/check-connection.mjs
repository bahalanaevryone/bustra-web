// Read-only check. Run: node --env-file=.env.local scripts/check-connection.mjs
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key)
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local first.')
for (const [name, path, options, expectDenied] of [
  ['Auth settings', '/auth/v1/settings', {}],
  ['Public service feed', '/rest/v1/rpc/public_feed', { method: 'POST', body: '{}' }],
  [
    'Pickup ETA API schema',
    '/rest/v1/rpc/eta_context',
    { method: 'POST', body: JSON.stringify({ p_trip: '00000000-0000-4000-8000-000000000000' }) },
    true,
  ],
  [
    'Admin role API schema',
    '/rest/v1/rpc/admin_update_user',
    {
      method: 'POST',
      body: JSON.stringify({
        p_user: '00000000-0000-4000-8000-000000000000',
        p_first_name: null,
        p_last_name: null,
        p_role: 'admin',
        p_confirm_admin: true,
        p_expected_role: 'user',
      }),
    },
    true,
  ],
  [
    'Role audit API schema',
    '/rest/v1/rpc/role_change_history',
    { method: 'POST', body: JSON.stringify({ p_limit: 1 }) },
    true,
  ],
]) {
  try {
    const result = await fetch(url + path, {
      ...options,
      headers: { apikey: key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    const json = await result.json()
    // Resolve the exact browser RPC arguments without an account session.
    // A permission denial is expected; PGRST202 means the live API cache is
    // missing the routine even when direct PostgreSQL tests have passed.
    if (expectDenied && [401, 403].includes(result.status) && json.code === '42501')
      console.log(`${name}: OK (signature resolved; guest access denied)`)
    else if (result.ok && !expectDenied)
      console.log(
        `${name}: OK (${result.status})${name === 'Public service feed' ? ` — ${json.trips?.length ?? 0} public trips` : ''}`,
      )
    else {
      console.log(
        `${name}: ${result.status} — ${json.message || json.msg || json.error_description || JSON.stringify(json)}`,
      )
      process.exitCode = 1
    }
  } catch (e) {
    console.log(`${name}: ${e.message}`)
    process.exitCode = 1
  }
}
