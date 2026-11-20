"""Optional future-phase ETA model. Requires real recorded arrival labels; never used by the app yet."""
import argparse
import csv
import json
import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--output", type=Path, default=Path(".artifacts/eta-model"))
    parser.add_argument("--baseline-speed-kmh", type=float, default=25)
    args = parser.parse_args()
    if not 5 <= args.baseline_speed_kmh <= 120:
        parser.error("Baseline speed must be between 5 and 120 km/h.")

    # Imports are intentionally optional: none of these dependencies are needed by the web app.
    import numpy as np
    import joblib
    from sklearn.linear_model import Ridge
    from sklearn.metrics import mean_absolute_error
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    rows = []
    with args.csv_file.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            observed = datetime.fromisoformat(row["observed_at"].replace("Z", "+00:00"))
            if observed.tzinfo is None:
                raise ValueError("observed_at must include a timezone.")
            local = observed.astimezone(ZoneInfo("Asia/Manila"))
            distance = float(row["road_distance_km"])
            stops = int(row["remaining_stops"])
            minutes = float(row["actual_minutes"])
            if not row["trip_id"].strip() or not all(math.isfinite(x) for x in (distance, minutes)) or distance < 0 or stops < 0 or minutes < 0:
                raise ValueError("Invalid trip id, distance, stop count, or arrival label.")
            hour = local.hour + local.minute / 60
            features = [distance, stops, math.sin(hour * math.pi / 12), math.cos(hour * math.pi / 12), local.weekday()]
            rows.append((row["trip_id"], observed, features, minutes))

    # Split chronologically by complete trip to avoid train/test leakage from the same journey.
    starts = {}
    for trip, observed, _, _ in rows:
        starts[trip] = min(starts.get(trip, observed), observed)
    trips = sorted(starts, key=starts.get)
    if len(trips) < 30:
        raise ValueError("Collect at least 30 distinct, complete trips before this initial experiment. More representative data is necessary for deployment.")
    split = int(len(trips) * 0.8)
    train_ids, test_ids = set(trips[:split]), set(trips[split:])
    train = [r for r in rows if r[0] in train_ids]
    test = [r for r in rows if r[0] in test_ids]
    # If trips overlap the holdout period, prevent future observations leaking into training.
    test_start = min(r[1] for r in test)
    train = [r for r in train if r[1] < test_start]
    if not train:
        raise ValueError("No chronological training records remain after excluding overlap.")
    model = make_pipeline(StandardScaler(), Ridge(alpha=1.0))
    model.fit(np.array([r[2] for r in train]), np.array([r[3] for r in train]))
    actual = np.array([r[3] for r in test])
    predicted = np.maximum(0, model.predict(np.array([r[2] for r in test])))
    baseline = np.array([r[2][0] / args.baseline_speed_kmh * 60 for r in test])
    metrics = {
        "status": "experimental, not approved for deployment",
        "training_rows": len(train), "holdout_rows": len(test),
        "training_trips": len(set(r[0] for r in train)), "holdout_trips": len(test_ids),
        "holdout_start": test_start.isoformat(),
        "baseline_speed_kmh": args.baseline_speed_kmh,
        "baseline_mae_minutes": float(mean_absolute_error(actual, baseline)),
        "model_mae_minutes": float(mean_absolute_error(actual, predicted)),
        "features": ["road_distance_km", "remaining_stops", "hour_sin", "hour_cos", "weekday"],
        "warning": "Evaluate per route/time period, larger representative holdouts, and monitoring before serving predictions.",
    }
    args.output.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, args.output / "model.joblib")
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
