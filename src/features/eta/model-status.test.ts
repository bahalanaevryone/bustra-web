import { expect, it } from 'vitest'
import {
  modelStatus,
  validateTrainedArtifact,
} from '../../../supabase/functions/_shared/model-status'
import { FEATURES } from '../../../supabase/functions/_shared/eta'
// In-memory format fixture only. Never exported, activated or used as model accuracy evidence.
const model = {
  schema_version: 1,
  eligible: true,
  algorithm: 'LinearRegression',
  version: 'unit-only',
  timezone: 'Asia/Manila',
  data_kind: 'verified_observations',
  dataset_sha256: 'a'.repeat(64),
  features: FEATURES,
  mean: [1, 30, 0, 0, 1, 5],
  scale: [1, 1, 1, 1, 1, 1],
  minimum: [0, 0, 0, -1, -1, 0],
  maximum: [100, 200, 1, 1, 1, 6],
  coefficients: [2, 0, 0, 0, 0, 0],
  intercept: 3,
  metrics: {
    valid_rows: 120,
    training_trips: 24,
    holdout_trips: 6,
    supported_holdout_trips: 6,
    model_mae_minutes: 1,
    raw_model_mae_minutes: 1,
    routing_mae_minutes: 2,
  },
  validation_cases: [{ features: [1, 30, 0, 0, 1, 5], expected_minutes: 3 }],
}
it('requires real-data provenance and matching exported inference before activation', () => {
  expect(validateTrainedArtifact(model)).toEqual([])
  expect(validateTrainedArtifact({ ...model, data_kind: 'test_fixture' }).join(' ')).toContain(
    'test fixtures',
  )
  expect(
    validateTrainedArtifact({
      ...model,
      validation_cases: [{ ...model.validation_cases[0], expected_minutes: 90 }],
    }).join(' '),
  ).toContain('does not match')
})
it('reports actual untrained, invalid and validated model states without invented accuracy', () => {
  expect(modelStatus({ status: 'untrained', eligible: false }).status).toBe('untrained')
  expect(modelStatus(model).status).toBe('active')
  expect(modelStatus({ ...model, scale: [0, 1, 1, 1, 1, 1] }).status).toBe('invalid_artifact')
  expect(modelStatus({ ...model, eligible: false }).status).toBe('routing_fallback')
})
