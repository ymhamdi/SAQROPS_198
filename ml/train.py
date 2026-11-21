"""Trains the three flashover models of ml/model/contract.json and writes everything the app and the report need.

Input: CSV files in the schema of ml/featurize.ts and ml/generate.ts (run, room, t, 13 features, y30, y60, tff,
censored). Splits BY RUN (never by time step): crc32(run) % 100 < 70 train, < 85 validation, else test. Decision
thresholds: the highest that keep recall >= 0.95 per time step on validation. Reports per time step and per scenario
(ml/evaluate.py) on the internal test split and on any external set given with --eval (the generalization matrix).

  python ml/train.py --data ml/data/scenarios_v2.csv --name "plan B v2" --out ml/runs/planB-v2 \
      --eval "UL FSRI=ml/data/fsri_features.csv"

--out ml/model replaces the shipped model (then regenerate nothing else: golden.csv is written here). Same code as the
Kaggle notebook (ml/kaggle/pnr-flashover.ipynb).
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import zlib
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

from evaluate import full_report, load_csv, plots, strip
from features import CONTRACT, FEATURE_NAMES

ROOT = Path(__file__).parent
TARGET_RECALL = 0.95
SEED = 42
DEVICE = "cpu"


def split_of(run: str) -> str:
    h = zlib.crc32(run.encode()) % 100
    return "train" if h < 70 else "val" if h < 85 else "test"


def threshold_for_recall(y: np.ndarray, s: np.ndarray, recall: float) -> float:
    pos = np.sort(s[y == 1])[::-1]
    if len(pos) == 0:
        return 0.5
    return float(pos[max(0, math.ceil(recall * len(pos)) - 1)])


def subset(d: dict, m: np.ndarray) -> dict:
    return {k: v[m] for k, v in d.items()}


def fit(X, y, Xv, yv, objective: str) -> xgb.Booster:
    params = {"objective": objective, "max_depth": 6, "eta": 0.08, "subsample": 0.9, "colsample_bytree": 0.9, "min_child_weight": 5,
              "seed": SEED, "nthread": 4, "tree_method": "hist", "device": DEVICE}
    if objective == "binary:logistic":
        pos = max(1, int(y.sum()))
        params.update(eval_metric="aucpr", scale_pos_weight=(len(y) - pos) / pos)
    else:
        params.update(eval_metric="mae")
    d = xgb.DMatrix(X, label=y, missing=np.nan, feature_names=FEATURE_NAMES)
    dv = xgb.DMatrix(Xv, label=yv, missing=np.nan, feature_names=FEATURE_NAMES)
    b = xgb.train(params, d, num_boost_round=400, evals=[(dv, "val")], early_stopping_rounds=40, verbose_eval=False)
    return b[: b.best_iteration + 1]


def predict(models: dict[str, xgb.Booster], X: np.ndarray) -> dict[str, np.ndarray]:
    d = xgb.DMatrix(X, missing=np.nan, feature_names=FEATURE_NAMES)
    return {k: m.predict(d) for k, m in models.items()}


def write_golden(models: dict[str, xgb.Booster], X: np.ndarray, out: Path) -> None:
    """R8 parity rows: test rows, at least a third with missing values (failed detectors)."""
    rng = np.random.default_rng(SEED)
    idx = np.arange(len(X))
    nan_idx = idx[np.isnan(X).any(axis=1)]
    pick = np.concatenate([rng.choice(nan_idx, size=min(100, len(nan_idx)), replace=False), rng.choice(idx, size=min(200, len(idx)), replace=False)])
    rows = X[pick]
    gold = predict(models, rows)
    with (out / "golden.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow([*FEATURE_NAMES, "p30", "p60", "tff"])
        for i, row in enumerate(rows):
            w.writerow([*("" if math.isnan(v) else repr(float(v)) for v in row), *(repr(float(gold[k][i])) for k in ("p30", "p60", "tff"))])


sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--name", required=True, help="what the training data is, for metrics.json and the interface")
    ap.add_argument("--status", default="MODELED", help="status of the training data (CFAST or our engine: MODELED)")
    ap.add_argument("--out", default=str(ROOT / "model"), help="model directory (ml/model is the shipped one)")
    ap.add_argument("--eval", action="append", default=[], metavar="NAME=CSV", help="external test set, repeatable")
    ap.add_argument("--report", default=None, help="directory for plots (default ml/report/<out dir name>)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report_dir = Path(args.report) if args.report else ROOT / "report" / out.name

    d = load_csv(args.data)
    split = np.array([split_of(r) for r in d["run"]])
    tr, va, te = (subset(d, split == s) for s in ("train", "val", "test"))
    print(f"rows: train {len(tr['t'])}, val {len(va['t'])}, test {len(te['t'])}; runs: {len(set(d['run']))}")

    models = {
        "p30": fit(tr["X"], tr["y30"], va["X"], va["y30"], "binary:logistic"),
        "p60": fit(tr["X"], tr["y60"], va["X"], va["y60"], "binary:logistic"),
        "tff": fit(tr["X"], tr["tff"], va["X"], va["tff"], "reg:squarederror"),
    }
    pv = predict(models, va["X"])
    thr = {k: threshold_for_recall(va["y30" if k == "p30" else "y60"], pv[k], TARGET_RECALL) for k in ("p30", "p60")}
    pt = predict(models, te["X"])
    internal = full_report(te, pt, thr)
    plot_files = plots(te, pt, internal, report_dir, args.name)

    # Single-feature baseline for the report: the room's 30 s slope plus failure, same recall target.
    j30, jf = FEATURE_NAMES.index("self_slope_30"), FEATURE_NAMES.index("self_frac_failed")
    base = lambda x: np.nan_to_num(x[:, j30]) + 10 * np.nan_to_num(x[:, jf])
    from evaluate import step_report

    baseline = step_report(te["y60"], base(te["X"]), threshold_for_recall(va["y60"], base(va["X"]), TARGET_RECALL))

    external = {}
    for spec in args.eval:
        name, path = spec.split("=", 1)
        e = load_csv([path])
        pe = predict(models, e["X"])
        rep = full_report(e, pe, thr)
        external[name] = {"data": path, **strip(rep), "plots": plots(e, pe, rep, report_dir / name.replace(" ", "_"), f"{name}")}

    for k, m in models.items():
        m.save_model(str(out / CONTRACT["models"][k]["file"]))
    write_golden(models, te["X"], out)
    metrics = {
        "status": "TRAINED",
        "trainedOn": args.name,
        "dataStatus": args.status,
        "data": args.data,
        "date": dt.datetime.now().isoformat(timespec="minutes"),
        "xgboost": xgb.__version__,
        "device": DEVICE,
        "contractVersion": CONTRACT["version"],
        "split": "by run, crc32(run) % 100: <70 train, <85 validation, else test",
        "rows": {"train": int(len(tr["t"])), "val": int(len(va["t"])), "test": int(len(te["t"]))},
        "targetRecall": TARGET_RECALL,
        "thresholds": thr,
        "trees": {k: len(m.get_dump()) for k, m in models.items()},
        "test": {**strip(internal), "baselineSlopeRule": {"p60": baseline}, "plots": plot_files},
        "external": external,
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    s = internal["scenario"]
    print(f"[{args.name}] test: p60 recall {internal['p60']['recall']:.3f} PR-AUC {internal['p60']['prAuc']:.3f}; scenarios {s['detected']}/{s['flashovers']} "
          f"detected, lead median {s['medianLeadS']:.0f} s P10 {s['p10LeadS']:.0f} s, false alarms {s['falseAlarmRooms']}/{s['quietRooms']}")
    for name, e in external.items():
        es = e["scenario"]
        print(f"[{args.name}] → {name}: scenarios {es['detected']}/{es['flashovers']} detected, lead median {es['medianLeadS']:.0f} s, "
              f"false alarms {es['falseAlarmRooms']}/{es['quietRooms']}; per step PR-AUC {e['p60']['prAuc']:.3f}")


if __name__ == "__main__":
    main()
