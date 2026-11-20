// Read-only check. Run: node --env-file=.env.local scripts/check-connection.mjs
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key)
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local first.')
for (const [name, path, options] of [
  ['Auth settings', '/auth/v1/settings', {}],
  ['Public service feed', '/rest/v1/rpc/public_feed', { method: 'POST', body: '{}' }],
]) {
  try {
    const result = await fetch(url + path, {
      ...options,
      headers: { apikey: key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    const json = await result.json()
    if (result.ok)
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
