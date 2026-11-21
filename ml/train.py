"""Trains the three flashover models of ml/model/contract.json and writes everything the app and the report need.

Input: one or more CSV files with the schema written by ml/prepare.py (NIST P-Flash) and ml/generate.ts (plan B):
    run, room, t, <13 features>, y30, y60, tff, censored
Splits BY RUN (never by time step): 70 % train, 15 % validation, 15 % test. The decision thresholds are the highest
that keep recall >= 0.95 on validation. Writes ml/model/model-30s.json, model-60s.json, model-tff.json, golden.csv
(R8 parity rows) and metrics.json. Same code as the Kaggle notebook (ml/kaggle/pnr-flashover.ipynb).

Run: python ml/train.py --data ml/data/scenarios.csv --name "plan B: our engine, 5 000 runs"
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import zlib
from pathlib import Path

import numpy as np
import xgboost as xgb

from features import CONTRACT, FEATURE_NAMES

MODEL_DIR = Path(__file__).parent / "model"
TARGET_RECALL = 0.95
SEED = 42


def load(paths: list[str]):
    runs, rooms, ts, X, y30, y60, tff, cens = [], [], [], [], [], [], [], []
    for path in paths:
        with open(path, newline="", encoding="utf-8") as f:
            r = csv.reader(f)
            head = next(r)
            idx = [head.index(n) for n in FEATURE_NAMES]
            col = {n: head.index(n) for n in ("run", "room", "t", "y30", "y60", "tff", "censored")}
            tag = Path(path).stem
            for row in r:
                runs.append(f"{tag}:{row[col['run']]}")
                rooms.append(int(row[col["room"]]))
                ts.append(float(row[col["t"]]))
                X.append([float(row[i]) if row[i] != "" else math.nan for i in idx])
                y30.append(int(row[col["y30"]]))
                y60.append(int(row[col["y60"]]))
                tff.append(float(row[col["tff"]]))
                cens.append(int(row[col["censored"]]))
    return (np.array(runs), np.array(rooms), np.array(ts), np.array(X, dtype=np.float64), np.array(y30), np.array(y60), np.array(tff), np.array(cens))


def split_of(run: str) -> str:
    """Deterministic split by run id (crc32): a run never straddles two splits."""
    h = zlib.crc32(run.encode()) % 100
    return "train" if h < 70 else "val" if h < 85 else "test"


def average_precision(y: np.ndarray, s: np.ndarray) -> float:
    order = np.argsort(-s, kind="mergesort")
    y = y[order]
    tp = np.cumsum(y)
    precision = tp / np.arange(1, len(y) + 1)
    return float((precision * y).sum() / max(1, y.sum()))


def threshold_for_recall(y: np.ndarray, s: np.ndarray, recall: float) -> float:
    """Highest threshold whose recall on (y, s) is still >= recall."""
    pos = np.sort(s[y == 1])[::-1]
    if len(pos) == 0:
        return 0.5
    k = max(0, math.ceil(recall * len(pos)) - 1)
    return float(pos[k])


def binary_report(y: np.ndarray, s: np.ndarray, thr: float) -> dict:
    pred = s >= thr
    tp = int((pred & (y == 1)).sum())
    fn = int((~pred & (y == 1)).sum())
    fp = int((pred & (y == 0)).sum())
    bins = np.clip((s * 10).astype(int), 0, 9)
    calib = [{"bin": f"{b / 10:.1f}-{(b + 1) / 10:.1f}", "n": int((bins == b).sum()), "predicted": float(s[bins == b].mean()) if (bins == b).any() else None, "observed": float(y[bins == b].mean()) if (bins == b).any() else None} for b in range(10)]
    return {
        "threshold": thr,
        "recall": tp / max(1, tp + fn),
        "falseNegativeRate": fn / max(1, tp + fn),
        "precision": tp / max(1, tp + fp),
        "prAuc": average_precision(y, s),
        "brier": float(((s - y) ** 2).mean()),
        "positives": int(y.sum()),
        "n": int(len(y)),
        "calibration": calib,
    }


def lead_times(runs, rooms, ts, tff, cens, s, thr) -> dict:
    """For each room that flashed over in the test runs: how long before the flashover the alert first rose."""
    leads, missed = [], 0
    keys = {}
    for i in range(len(runs)):
        if cens[i] == 0:
            keys.setdefault((runs[i], rooms[i]), ts[i] + tff[i])
    for (run, room), fo in keys.items():
        m = (runs == run) & (rooms == room)
        alerted = ts[m][s[m] >= thr]
        if len(alerted):
            leads.append(fo - alerted.min())
        else:
            missed += 1
    a = np.array(leads) if leads else np.array([np.nan])
    return {"rooms": len(keys), "missed": missed, "medianLeadS": float(np.nanmedian(a)), "p10LeadS": float(np.nanpercentile(a, 10)), "p90LeadS": float(np.nanpercentile(a, 90))}


def fit_binary(X, y, Xv, yv) -> xgb.Booster:
    pos = max(1, int(y.sum()))
    params = {"objective": "binary:logistic", "eval_metric": "aucpr", "max_depth": 6, "eta": 0.08, "subsample": 0.9, "colsample_bytree": 0.9, "min_child_weight": 5, "scale_pos_weight": (len(y) - pos) / pos, "seed": SEED, "nthread": 4}
    d = xgb.DMatrix(X, label=y, missing=np.nan, feature_names=FEATURE_NAMES)
    dv = xgb.DMatrix(Xv, label=yv, missing=np.nan, feature_names=FEATURE_NAMES)
    return xgb.train(params, d, num_boost_round=400, evals=[(dv, "val")], early_stopping_rounds=40, verbose_eval=False)


def fit_tff(X, y, Xv, yv) -> xgb.Booster:
    params = {"objective": "reg:squarederror", "eval_metric": "mae", "max_depth": 6, "eta": 0.08, "subsample": 0.9, "colsample_bytree": 0.9, "seed": SEED, "nthread": 4}
    d = xgb.DMatrix(X, label=y, missing=np.nan, feature_names=FEATURE_NAMES)
    dv = xgb.DMatrix(Xv, label=yv, missing=np.nan, feature_names=FEATURE_NAMES)
    return xgb.train(params, d, num_boost_round=400, evals=[(dv, "val")], early_stopping_rounds=40, verbose_eval=False)


def predict(b: xgb.Booster, X) -> np.ndarray:
    # iteration_range: the best round found by early stopping, as save_model keeps it.
    return b.predict(xgb.DMatrix(X, missing=np.nan, feature_names=FEATURE_NAMES), iteration_range=(0, b.best_iteration + 1))


def trim(b: xgb.Booster) -> xgb.Booster:
    """Keep only the trees up to the best iteration, so the saved model is exactly what was evaluated."""
    return b[: b.best_iteration + 1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--name", required=True, help="what the data is, for metrics.json and the interface")
    ap.add_argument("--status", default="MODELED", help="status of the training data (CFAST / our engine: MODELED)")
    args = ap.parse_args()

    runs, rooms, ts, X, y30, y60, tff, cens = load(args.data)
    split = np.array([split_of(r) for r in runs])
    tr, va, te = split == "train", split == "val", split == "test"
    print(f"rows: train {tr.sum()}, val {va.sum()}, test {te.sum()}; runs: {len(set(runs))}")

    models = {"p30": trim(fit_binary(X[tr], y30[tr], X[va], y30[va])), "p60": trim(fit_binary(X[tr], y60[tr], X[va], y60[va]))}
    uncens = ~cens.astype(bool)
    models["tff"] = trim(fit_tff(X[tr], tff[tr], X[va], tff[va]))

    pred = {k: m.predict(xgb.DMatrix(X, missing=np.nan, feature_names=FEATURE_NAMES)) for k, m in models.items()}
    thr = {k: threshold_for_recall((y30 if k == "p30" else y60)[va], pred[k][va], TARGET_RECALL) for k in ("p30", "p60")}
    report = {k: binary_report((y30 if k == "p30" else y60)[te], pred[k][te], thr[k]) for k in ("p30", "p60")}
    report["p60"]["leadTimes"] = lead_times(runs[te], rooms[te], ts[te], tff[te], cens[te], pred["p60"][te], thr["p60"])
    mte = te & uncens
    report["tff"] = {"maeS": float(np.abs(pred["tff"][mte] - tff[mte]).mean()) if mte.any() else None, "n": int(mte.sum())}

    # Baseline for the report: one hand-made rule on a single feature (the room's 30 s slope), same recall target.
    base_score = np.nan_to_num(X[:, FEATURE_NAMES.index("self_slope_30")], nan=0.0) + 10 * np.nan_to_num(X[:, FEATURE_NAMES.index("self_frac_failed")], nan=0.0)
    report["baselineSlopeRule"] = {"p60": binary_report(y60[te], base_score[te] / max(1e-9, base_score.max()), threshold_for_recall(y60[va], base_score[va] / max(1e-9, base_score.max()), TARGET_RECALL))}

    for k, m in models.items():
        m.save_model(str(MODEL_DIR / CONTRACT["models"][k]["file"]))

    # Golden rows for R8: test rows, at least a third with missing values.
    rng = np.random.default_rng(SEED)
    te_idx = np.where(te)[0]
    nan_idx = te_idx[np.isnan(X[te_idx]).any(axis=1)]
    pick = np.concatenate([rng.choice(nan_idx, size=min(100, len(nan_idx)), replace=False), rng.choice(te_idx, size=min(200, len(te_idx)), replace=False)])
    rows = X[pick]
    gold = {k: m.predict(xgb.DMatrix(rows, missing=np.nan, feature_names=FEATURE_NAMES)) for k, m in models.items()}
    with (MODEL_DIR / "golden.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow([*FEATURE_NAMES, "p30", "p60", "tff"])
        for i, row in enumerate(rows):
            w.writerow([*("" if math.isnan(v) else repr(float(v)) for v in row), *(repr(float(gold[k][i])) for k in ("p30", "p60", "tff"))])

    metrics = {
        "status": "TRAINED",
        "trainedOn": args.name,
        "dataStatus": args.status,
        "data": args.data,
        "date": dt.datetime.now().isoformat(timespec="minutes"),
        "xgboost": xgb.__version__,
        "contractVersion": CONTRACT["version"],
        "split": "by run, crc32(run) % 100: <70 train, <85 validation, else test",
        "rows": {"train": int(tr.sum()), "val": int(va.sum()), "test": int(te.sum())},
        "targetRecall": TARGET_RECALL,
        "thresholds": thr,
        "trees": {k: len(m.get_dump()) for k, m in models.items()},
        "test": report,
    }
    (MODEL_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    p60 = report["p60"]
    print(f"p60: recall {p60['recall']:.3f}, precision {p60['precision']:.3f}, PR-AUC {p60['prAuc']:.3f}, median lead {p60['leadTimes']['medianLeadS']:.0f} s; tff MAE {report['tff']['maeS']}")


if __name__ == "__main__":
    main()
