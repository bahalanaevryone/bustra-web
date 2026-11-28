// Validate real-data evidence and Python/TypeScript parity before replacing the bundled artifact.
import { validateTrainedArtifact } from '../../supabase/functions/_shared/model-status.ts'
const file = Deno.args.find((arg) => !arg.startsWith('--'))
if (!file) {
  console.error(
    'Usage: deno run --allow-read [--allow-write] scripts/ai/activate-model.ts PATH_TO_MODEL_JSON [--activate]',
  )
  Deno.exit(1)
}
const model = JSON.parse(await Deno.readTextFile(file))
const errors = validateTrainedArtifact(model)
if (errors.length) {
  console.error(JSON.stringify({ status: 'rejected', errors }, null, 2))
  Deno.exit(1)
}
if (Deno.args.includes('--activate')) {
  await Deno.writeTextFile(
    new URL('../../supabase/functions/predict-eta/model.json', import.meta.url),
    JSON.stringify(model, null, 2) + '\n',
  )
  console.log(
    JSON.stringify({
      status: 'bundled',
      version: model.version,
      next: 'Deploy predict-eta, then compare predictions against actual later trip arrivals.',
    }),
  )
} else
  console.log(
    JSON.stringify({
      status: 'validated',
      version: model.version,
      next: 'Review the holdout results and field coverage before using --activate.',
    }),
  )
