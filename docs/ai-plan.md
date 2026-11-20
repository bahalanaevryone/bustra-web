# ETA and the optional AI phase

Current status: **planned / not trained**. No historical arrival labels exist in this checkout. The app does not invoke a model or report accuracy.

`getBasicEta(roadDistanceKm, speedKmh)` returns an approximate number of minutes only for valid road distance and speed assumptions (5–120 km/h). It returns `null` without them. No routing provider is configured, so the UI honestly displays ETA unavailable. The map's straight lines, map viewport, and demo coordinates are not road distances. A mathematical distance/speed estimate is not AI.

## Minimum additional evidence

Before training, collect real trip-stop arrivals with the operator's approval. For each prediction observation, record a non-personal trip identifier, timestamp with timezone, **remaining road distance** from a verified route, remaining stops, and actual minutes until arrival (filled in after that arrival). Features must be available at prediction time. Avoid any passenger/device identifiers or inferred labels.

A minimal optional `trip_stop_events` table could store trip_id, pickup_point_id, observed_at, actual_arrival_at, remaining_road_distance_km, and remaining_stops. This would be an **eighth application table**. It is only a proposal: there is no migration for it, and project-owner approval is required before expanding the seven-table core. Document retention, purpose, access, and data quality before collection. Alternatively, an operator-managed approved CSV can support the first offline experiment.

## Train a real initial model

`scripts/ai/train.py` fits a regularised linear regression using scikit-learn. It refuses fewer than 30 complete distinct trips. Thirty is only a starter experiment threshold, not evidence of adequate accuracy. The CSV template contains a header only; no synthetic observations or invented accuracy are included.

```powershell
python -m venv .artifacts/ai-venv
.artifacts/ai-venv/Scripts/python.exe -m pip install -r scripts/ai/requirements.txt
.artifacts/ai-venv/Scripts/python.exe scripts/ai/train.py PATH_TO_APPROVED_ACTUAL_ARRIVALS.csv
```

Timezone support on Windows may require `pip install tzdata`. Python 3.11+ is recommended. The dependencies and training execution have not been validated in this Node-only implementation environment.

Expected CSV columns:

| Column             | Meaning                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `trip_id`          | Non-personal journey identifier; all observations of one trip stay in one split.      |
| `observed_at`      | ISO timestamp with timezone for the prediction observation.                           |
| `road_distance_km` | Remaining **road** distance to the target stop, validated from route data.            |
| `remaining_stops`  | Nonnegative stop count from the observation to the target.                            |
| `actual_minutes`   | Measured minutes from observation until the actual arrival. Never an estimated label. |

The script holds out the latest 20% of complete trip groups, excludes training observations overlapping the holdout period, and fits scaling only on training data. It compares model MAE in minutes against a fixed 25 km/h road-distance baseline (configurable). It writes an ignored `.artifacts/eta-model/model.joblib` and metrics JSON. An MAE result is an error measure, not a percentage accuracy guarantee. Check per-route/time-of-day errors and failure cases, and compare with an independent later period.

Do not deploy merely because the script finishes. After adequate representative evaluation, add a secured inference service accepting only the approved features, a versioned model, monitoring, and a conservative fallback. Load only trusted model artifacts. The current client deliberately has no inference URL or simulated AI response.
