// Read-only provider smoke check with fixed example route endpoints, never simulated bus data.
import { roadRoute } from '../../supabase/functions/_shared/eta.ts'
const base = Deno.env.get('ETA_ROUTING_URL') || 'https://router.project-osrm.org'
try {
  const result = await roadRoute(base, [
    [13.2233, 120.596],
    [13.237, 120.601],
  ])
  console.log(
    JSON.stringify({
      distance_m: result.distance,
      duration_s: result.duration,
      road_vertices: result.coordinates.length,
    }),
  )
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Routing failed')
  Deno.exit(1)
}
