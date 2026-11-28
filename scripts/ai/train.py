"""Train an ETA baseline from GPS-verified observations, never synthetic production data."""
import argparse
import csv
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

FEATURES = ["road_distance_km", "speed_kmh", "speed_missing", "hour_sin", "hour_cos", "weekday"]
MANILA = timezone(timedelta(hours=8))


def timestamp(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamps must include their timezone.")
    return result


def load_rows(path):
    rows, ignored, seen = [], 0, set()
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            try:
                observed, arrived = timestamp(row["observed_at"]), timestamp(row["actual_arrival_at"])
                trip = row["trip_id"].strip()
                distance = float(row["remaining_road_distance_m"])
                baseline, actual = float(row["routing_minutes"]), float(row["actual_remaining_minutes"])
                speed = float(row["speed_kmh"]) if row.get("speed_kmh", "").strip() else None
                local = observed.astimezone(MANILA)
                hour = local.hour + local.minute / 60
                if not trip or not all(math.isfinite(v) for v in [distance, baseline, actual]) or not 0 < distance <= 2_000_000 or not 0 < baseline <= 720 or not 0 < actual <= 720:
                    raise ValueError("Invalid numerical features")
                if speed is not None and (not math.isfinite(speed) or not 0 <= speed <= 200):
                    raise ValueError("Invalid speed")
                if arrived <= observed or abs((arrived-observed).total_seconds()/60-actual) > 0.001:
                    raise ValueError("Arrival label does not match timestamps")
                key = (trip, observed, arrived, distance)
                if key in seen:
                    raise ValueError("Duplicate observation")
                seen.add(key)
                x = [distance / 1000, speed or 0, int(speed is None), math.sin(hour*math.pi/12), math.cos(hour*math.pi/12), local.weekday()]
                rows.append(dict(trip=trip, observed=observed, arrived=arrived, x=x, actual=actual, baseline=baseline))
            except (ValueError, KeyError, TypeError, AttributeError):
                ignored += 1
    return sorted(rows, key=lambda r: r["observed"]), ignored


def chronological_split(rows, fraction=0.8):
    starts = {}
    for row in rows:
        starts[row["trip"]] = min(starts.get(row["trip"], row["observed"]), row["observed"])
    trips = sorted(starts, key=lambda t: (starts[t], t))
    index = int(len(trips)*fraction)
    train_ids, test_ids = set(trips[:index]), set(trips[index:])
    test = [r for r in rows if r["trip"] in test_ids]
    if not test:
        return [], []
    cutoff = min(r["observed"] for r in test)
    # Purge whole overlapping trips, including labels only known after the holdout begins.
    overlap = {r["trip"] for r in rows if r["trip"] in train_ids and r["arrived"] >= cutoff}
    return [r for r in rows if r["trip"] in train_ids - overlap], test


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+"\n", encoding="utf-8")


def train(csv_file, output, random_forest=False):
    output.mkdir(parents=True, exist_ok=True)
    rows, ignored = load_rows(csv_file)
    train_rows, test_rows = chronological_split(rows)
    counts = dict(valid_rows=len(rows), ignored_rows=ignored, training_rows=len(train_rows), holdout_rows=len(test_rows), training_trips=len({r["trip"] for r in train_rows}), holdout_trips=len({r["trip"] for r in test_rows}))
    data_kind = "test_fixture" if any(r["trip"].upper().startswith(("SYNTHETIC", "TEST", "DEMO")) for r in rows) else "verified_observations"
    metadata = dict(dataset_sha256=hashlib.sha256(csv_file.read_bytes()).hexdigest(), data_kind=data_kind, features=FEATURES, timezone="Asia/Manila", **counts)
    if len({r["trip"] for r in rows}) < 30 or len(rows) < 60 or counts["training_trips"] < 20 or counts["holdout_trips"] < 6:
        metrics = dict(status="insufficient_data", reason="Collect at least 60 GPS-verified observations from 30 complete distinct trips; at least 20 training and 6 future holdout trips must survive chronological purging.", **metadata)
        write_json(output / "metrics.json", metrics)
        write_json(output / "model.json", dict(schema_version=1, eligible=False, status="untrained", reason=metrics["reason"]))
        return metrics

    import joblib
    import numpy as np
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    x_train, y_train = np.array([r["x"] for r in train_rows]), np.array([r["actual"] for r in train_rows])
    x_test, actual = np.array([r["x"] for r in test_rows]), np.array([r["actual"] for r in test_rows])
    pipeline = make_pipeline(StandardScaler(), LinearRegression())
    pipeline.fit(x_train, y_train)
    raw_predictions = pipeline.predict(x_test)
    lower, upper = x_train.min(axis=0), x_train.max(axis=0)
    supported = np.all((x_test >= lower - 1e-9) & (x_test <= upper + 1e-9), axis=1) & (raw_predictions >= 0) & (raw_predictions <= 720)
    routing = np.array([r["baseline"] for r in test_rows])
    served = np.where(supported, raw_predictions, routing)
    model_mae, routing_mae = float(mean_absolute_error(actual, served)), float(mean_absolute_error(actual, routing))
    supported_trips = len({r["trip"] for r, ok in zip(test_rows, supported) if ok})
    raw_mae = float(mean_absolute_error(actual, raw_predictions))
    metrics = dict(status="evaluated", algorithm="LinearRegression", routing_mae_minutes=routing_mae, model_mae_minutes=model_mae, raw_model_mae_minutes=raw_mae, supported_holdout_trips=supported_trips, holdout_ai_coverage=float(supported.mean()), holdout_start=min(r["observed"] for r in test_rows).isoformat(), **metadata)
    metrics["per_trip"] = {}
    for trip in sorted({r["trip"] for r in test_rows}):
        mask = np.array([r["trip"] == trip for r in test_rows])
        metrics["per_trip"][trip] = dict(rows=int(mask.sum()), model_mae_minutes=float(mean_absolute_error(actual[mask], served[mask])), routing_mae_minutes=float(mean_absolute_error(actual[mask], routing[mask])))
    if random_forest:
        from sklearn.ensemble import RandomForestRegressor
        # Fixed configuration; never tune on the final holdout or export a forest as linear coefficients.
        forest = RandomForestRegressor(n_estimators=200, min_samples_leaf=5, random_state=42, n_jobs=-1)
        forest.fit(x_train, y_train)
        forest_mae = float(mean_absolute_error(actual, forest.predict(x_test)))
        metrics["random_forest_mae_minutes"] = forest_mae
        metrics["random_forest_followup"] = "Evaluate on another future holdout and build a private Python inference service." if forest_mae < min(model_mae, routing_mae)*0.9 else "No significant improvement on this holdout."
        joblib.dump(forest, output / "random-forest.joblib")
    scaler, regression = pipeline.steps[0][1], pipeline.steps[1][1]
    exported = regression.intercept_ + ((x_test-scaler.mean_) / scaler.scale_) @ regression.coef_
    if not np.allclose(exported, raw_predictions, rtol=1e-10, atol=1e-10):
        raise ValueError("Exported inference does not match scikit-learn.")
    eligible = bool(data_kind == "verified_observations" and model_mae < routing_mae and raw_mae < routing_mae and supported_trips >= 6)
    reason = "Evaluated linear model improves on the routing baseline." if eligible else "Software test fixture; never activate this artifact." if data_kind == "test_fixture" else "Model did not improve on routing or lacks supported predictions across six future test trips."
    artifact = dict(schema_version=1, eligible=eligible, status="evaluated", reason=reason, data_kind=data_kind, dataset_sha256=metadata["dataset_sha256"], trained_at=datetime.now(timezone.utc).isoformat(), algorithm="LinearRegression", version="linear-"+metadata["dataset_sha256"][:12], features=FEATURES, timezone="Asia/Manila", coefficients=regression.coef_.tolist(), intercept=float(regression.intercept_), mean=scaler.mean_.tolist(), scale=scaler.scale_.tolist(), minimum=lower.tolist(), maximum=upper.tolist(), validation_cases=[dict(features=x_test[i].tolist(), expected_minutes=float(raw_predictions[i])) for i in np.flatnonzero(supported)[:5]], metrics={k: v for k, v in metrics.items() if k not in ("per_trip", "dataset_sha256")})
    metrics["eligible"] = artifact["eligible"]
    metrics["limitation"] = "A starter holdout is not a guarantee of accuracy. Review route/time coverage and later independent trips before deploying."
    write_json(output / "metrics.json", metrics)
    write_json(output / "model.json", artifact)
    joblib.dump(pipeline, output / "model.joblib")
    with (output / "holdout-predictions.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["trip_id", "observed_at", "actual_minutes", "routing_minutes", "raw_model_minutes", "served_minutes", "ai_supported"])
        writer.writerows([r["trip"], r["observed"].isoformat(), r["actual"], r["baseline"], float(p), float(s), bool(ok)] for r, p, s, ok in zip(test_rows, raw_predictions, served, supported))
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--output", type=Path, default=Path(".artifacts/eta-model"))
    parser.add_argument("--random-forest", action="store_true", help="Evaluate a fixed Random Forest challenger; never export it as a linear model.")
    args = parser.parse_args()
    metrics = train(args.csv_file, args.output, args.random_forest)
    print(json.dumps(metrics, indent=2))
    return 2 if metrics["status"] == "insufficient_data" else 0


if __name__ == "__main__":
    raise SystemExit(main())
