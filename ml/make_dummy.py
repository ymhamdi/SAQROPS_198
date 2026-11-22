"""Placeholder models that honour ml/model/contract.json, so the app never waits for training (CLAUDE.md §8, 15:30).

Trains tiny XGBoost models on synthetic detector histories (t-squared fires, noise, failures at 150 degC). The numbers
mean nothing: metrics.json says DUMMY and the app shows it. Also writes the parity fixtures:
  golden.csv             features + Python predictions (R8, read by app/src/ml/xgb.test.ts)
  golden-features.json   raw histories + Python features (read by app/src/ml/features.test.ts)
Run: python ml/make_dummy.py
"""

from __future__ import annotations

import csv
import json
import math
import random
from pathlib import Path

import numpy as np
import xgboost as xgb

from features import CONTRACT, FEATURE_NAMES, NAN, feature_vector, room_stats

MODEL_DIR = Path(__file__).parent / "model"
FAIL_C = 150.0  # mirrors data/config.json fire.detectorFailureC
FLASHOVER_C = 600.0  # mirrors data/config.json fire.flashoverC
SEED = 42


def synthetic_room(rng: random.Random, n_det: int, ignition_s: float, alpha: float, dt: float, duration: float):
    """Gas temperature rising like a t-squared fire (dummy physics), detectors with noise and failure above FAIL_C."""
    t = [i * dt for i in range(int(duration / dt) + 1)]
    truth = [20.0 + (0.0 if s < ignition_s else alpha * (s - ignition_s) ** 2) for s in t]
    readings = []
    for d in range(n_det):
        lag = rng.uniform(0.6, 1.0)
        failed = False
        series = []
        for v in truth:
            r = 20.0 + (v - 20.0) * lag + rng.gauss(0, 0.5)
            if failed or r > FAIL_C:
                failed = True
                series.append(NAN)
            else:
                series.append(r)
        readings.append(series)
    flash_s = next((s for s, v in zip(t, truth) if v >= FLASHOVER_C), math.inf)
    return t, readings, flash_s


def build(rng: random.Random, runs: int):
    X, y30, y60, tff, raw = [], [], [], [], []
    for _ in range(runs):
        dt = rng.choice([1.0, 2.0, 5.0])
        rooms = [synthetic_room(rng, rng.randint(1, 3), rng.uniform(0, 200) if r == 0 else rng.uniform(150, 600), rng.uniform(0.002, 0.05), dt, 600.0) for r in range(3)]
        for t_now in np.arange(30.0, 600.0, 15.0):
            stats = [room_stats(t, rd, float(t_now)) for t, rd, _ in rooms]
            for i, (_, _, flash) in enumerate(rooms):
                X.append(feature_vector(stats[i], [s for j, s in enumerate(stats) if j != i]))
                left = flash - t_now
                y30.append(1 if 0 <= left <= 30 or (left < 0) else 0)
                y60.append(1 if 0 <= left <= 60 or (left < 0) else 0)
                tff.append(min(max(left, 0.0), CONTRACT["tffCapS"]) if math.isfinite(left) else CONTRACT["tffCapS"])
        if len(raw) < 6:
            raw.append(rooms)
    return np.array(X, dtype=float), np.array(y30), np.array(y60), np.array(tff), raw


def fit(X, y, objective: str) -> xgb.Booster:
    d = xgb.DMatrix(X, label=y, missing=np.nan, feature_names=FEATURE_NAMES)
    params = {"objective": objective, "max_depth": 3, "eta": 0.3, "seed": SEED, "nthread": 1}
    return xgb.train(params, d, num_boost_round=25)


def main() -> None:
    rng = random.Random(SEED)
    X, y30, y60, tff, raw = build(rng, 40)
    models = {
        "p30": fit(X, y30, "binary:logistic"),
        "p60": fit(X, y60, "binary:logistic"),
        "tff": fit(X, tff, "reg:squarederror"),
    }
    for key, booster in models.items():
        booster.save_model(str(MODEL_DIR / CONTRACT["models"][key]["file"]))

    # Golden rows: a spread of samples, including rows with missing values (failed detectors).
    pick = np.random.default_rng(SEED).choice(len(X), size=min(300, len(X)), replace=False)
    rows = X[pick]
    d = xgb.DMatrix(rows, missing=np.nan, feature_names=FEATURE_NAMES)
    preds = {k: m.predict(d) for k, m in models.items()}
    with (MODEL_DIR / "golden.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow([*FEATURE_NAMES, "p30", "p60", "tff"])
        for i, row in enumerate(rows):
            w.writerow([*("" if math.isnan(v) else repr(float(v)) for v in row), *(repr(float(preds[k][i])) for k in ("p30", "p60", "tff"))])

    # Feature parity fixture: raw histories and the features Python computes from them at a few times.
    cases = []
    for rooms in raw:
        for t_now in (0.0, 45.0, 200.0, 333.0, 600.0):
            stats = [room_stats(t, rd, t_now) for t, rd, _ in rooms]
            cases.append({
                "tNow": t_now,
                "rooms": [{"t": t, "readings": [[None if math.isnan(v) else v for v in d] for d in rd]} for t, rd, _ in rooms],
                "features": [[None if math.isnan(v) else v for v in feature_vector(stats[i], [s for j, s in enumerate(stats) if j != i])] for i in range(len(rooms))],
            })
    (MODEL_DIR / "golden-features.json").write_text(json.dumps({"cases": cases}), encoding="utf-8")

    (MODEL_DIR / "metrics.json").write_text(json.dumps({
        "status": "DUMMY",
        "note": "Placeholder trained on synthetic t-squared histories to freeze the format. Not a model of anything.",
        "xgboost": xgb.__version__,
        "contractVersion": CONTRACT["version"],
        "thresholds": {"p30": 0.5, "p60": 0.5},
    }, indent=2) + "\n", encoding="utf-8")
    print(f"dummy models written: {len(X)} rows, golden {len(rows)} rows, {len(cases)} feature cases")


if __name__ == "__main__":
    main()
