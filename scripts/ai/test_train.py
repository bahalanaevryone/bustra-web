"""Synthetic fixtures test plumbing only; they are not production model evaluation evidence."""
import csv
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from train import FEATURES, chronological_split, load_rows, train

FIELDS = ["trip_id", "remaining_road_distance_m", "routing_minutes", "speed_kmh", "observed_at", "actual_arrival_at", "actual_remaining_minutes"]


class TrainingTests(unittest.TestCase):
    def write(self, directory, rows):
        path = directory / "fixture.csv"
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        return path

    def test_empty_data_produces_no_claims_or_trained_artifact(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = train(self.write(root, []), root / "output")
            self.assertEqual(result["status"], "insufficient_data")
            self.assertNotIn("model_mae_minutes", result)
            self.assertFalse((root / "output/model.joblib").exists())

    def test_split_purges_whole_trips_with_future_labels(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = [dict(trip=str(i), observed=start+timedelta(days=i), arrived=start+timedelta(days=i, minutes=10)) for i in range(10)]
        rows[0]["arrived"] = start+timedelta(days=9)
        training, test = chronological_split(rows)
        self.assertNotIn("0", [r["trip"] for r in training])
        self.assertTrue(max(r["arrived"] for r in training) < min(r["observed"] for r in test))

    def test_training_and_export_on_explicit_test_fixture(self):
        import json
        import joblib
        import numpy as np
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = []
        for trip in range(30):
            for step in range(4):
                observed = start+timedelta(days=trip, minutes=step)
                actual = 6-step
                rows.append(dict(trip_id=f"SYNTHETIC-TEST-{trip}", remaining_road_distance_m=3000-step*500, routing_minutes=10-step, speed_kmh=30, observed_at=observed.isoformat(), actual_arrival_at=(observed+timedelta(minutes=actual)).isoformat(), actual_remaining_minutes=actual))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            csv_path = self.write(root, rows)
            metrics = train(csv_path, root / "output", random_forest=True)
            self.assertEqual(metrics["training_trips"], 24)
            self.assertEqual(metrics["holdout_trips"], 6)
            artifact = json.loads((root / "output/model.json").read_text())
            self.assertEqual(artifact["features"], FEATURES)
            self.assertEqual(artifact["data_kind"], "test_fixture")
            self.assertFalse(artifact["eligible"])
            loaded, _ = load_rows(csv_path)
            x = np.array([loaded[0]["x"]])
            prediction = artifact["intercept"] + sum((v-m)/s*c for v, m, s, c in zip(x[0], artifact["mean"], artifact["scale"], artifact["coefficients"]))
            self.assertAlmostEqual(prediction, joblib.load(root / "output/model.joblib").predict(x)[0])
            rows[0]["actual_remaining_minutes"] = 999
            invalid, ignored = load_rows(self.write(root, rows))
            self.assertEqual((ignored, len(invalid)), (1, 119))


if __name__ == "__main__":
    unittest.main()
