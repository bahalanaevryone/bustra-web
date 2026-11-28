import { FEATURES, modelPrediction } from './eta.ts'
export const TRAINING_REQUIREMENTS = {
  minimum_observations: 60,
  minimum_completed_trips: 30,
  minimum_training_trips: 20,
  minimum_holdout_trips: 6,
  holdout_fraction: 0.2,
}
export function validateTrainedArtifact(model: unknown): string[] {
  const m = model && typeof model === 'object' ? (model as Record<string, any>) : {}
  const errors: string[] = []
  if (
    ![
      m.metrics?.valid_rows,
      m.metrics?.supported_holdout_trips,
      m.metrics?.raw_model_mae_minutes,
    ].every(Number.isFinite)
  )
    errors.push('Evaluation counts and errors must be finite numbers.')
  if (m.data_kind !== 'verified_observations')
    errors.push(
      'Only verified real observations may be activated; test fixtures are not deployable.',
    )
  if (typeof m.dataset_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.dataset_sha256))
    errors.push('The source dataset fingerprint is missing.')
  if (
    !Array.isArray(m.mean) ||
    m.mean.length !== FEATURES.length ||
    !modelPrediction(model, m.mean)
  )
    errors.push('The inference artifact is invalid or not eligible.')
  if (!(
    m.metrics?.valid_rows >= 60 &&
    m.metrics?.supported_holdout_trips >= 6 &&
    Number.isFinite(m.metrics?.raw_model_mae_minutes) &&
    m.metrics?.raw_model_mae_minutes < m.metrics?.routing_mae_minutes
  ))
    errors.push('Insufficient verified rows, supported future test trips, or baseline improvement.')
  if (!Array.isArray(m.validation_cases) || !m.validation_cases.length)
    errors.push('Export parity cases are missing.')
  else
    for (const item of m.validation_cases) {
      const prediction = Array.isArray(item.features) ? modelPrediction(model, item.features) : null
      if (
        !prediction ||
        !Number.isFinite(item.expected_minutes) ||
        Math.abs(prediction.minutes - item.expected_minutes) > 1e-8
      )
        errors.push('TypeScript inference does not match an exported scikit-learn parity case.')
    }
  return [...new Set(errors)]
}
export function modelStatus(model: unknown) {
  const m = model && typeof model === 'object' ? (model as Record<string, any>) : {}
  const probe = Array.isArray(m.mean) ? m.mean : []
  const valid = probe.length === FEATURES.length && modelPrediction(model, probe) !== null
  const status = valid
    ? 'active'
    : m.status === 'untrained' || !m.algorithm
      ? 'untrained'
      : m.eligible !== true
        ? 'routing_fallback'
        : 'invalid_artifact'
  return {
    status,
    algorithm: m.algorithm ?? 'LinearRegression',
    version: valid ? m.version : null,
    reason: valid
      ? 'Validated linear artifact available; supported inputs use model inference.'
      : (m.reason ??
        'The artifact is unavailable, invalid, or did not improve on routing. Routing fallback is active.'),
    metrics: m.metrics
      ? {
          training_trips: m.metrics.training_trips,
          holdout_trips: m.metrics.holdout_trips,
          model_mae_minutes: m.metrics.model_mae_minutes,
          routing_mae_minutes: m.metrics.routing_mae_minutes,
          holdout_ai_coverage: m.metrics.holdout_ai_coverage,
        }
      : null,
  }
}
