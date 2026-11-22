"""Evaluation shared by ml/train.py and ml/validate_fsri.py: per time step and per scenario.

Per scenario = per (run, room): a room that flashes over is detected when the 60 s alert rises at least once before the
flashover; the lead time is the flashover time minus the first alert. A room that never flashes over is a false alarm
when the alert rises at all. Thresholds are the ones chosen on validation (recall >= 0.95 per time step).

CLI, to score a shipped model on a features CSV:
  python ml/evaluate.py --model ml/model --data ml/data/fsri_features.csv --name "UL FSRI" --out ml/report/fsri
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

from features import CONTRACT, FEATURE_NAMES


def load_csv(paths: list[str]):
    """Rows of the scenarios.csv schema: run ids are prefixed by the file stem so two datasets never collide."""
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
                rooms.append(row[col["room"]])
                ts.append(float(row[col["t"]]))
                X.append([float(row[i]) if row[i] != "" else math.nan for i in idx])
                y30.append(int(row[col["y30"]]))
                y60.append(int(row[col["y60"]]))
                tff.append(float(row[col["tff"]]))
                cens.append(int(row[col["censored"]]))
    return dict(run=np.array(runs), room=np.array(rooms), t=np.array(ts), X=np.array(X, dtype=np.float64), y30=np.array(y30), y60=np.array(y60), tff=np.array(tff), cens=np.array(cens))


def load_models(model_dir: Path) -> dict[str, xgb.Booster]:
    out = {}
    for key, spec in CONTRACT["models"].items():
        b = xgb.Booster()
        b.load_model(str(model_dir / spec["file"]))
        out[key] = b
    return out


def predict_all(models: dict[str, xgb.Booster], X: np.ndarray) -> dict[str, np.ndarray]:
    d = xgb.DMatrix(X, missing=np.nan, feature_names=FEATURE_NAMES)
    return {k: m.predict(d) for k, m in models.items()}


def average_precision(y: np.ndarray, s: np.ndarray) -> float:
    if y.sum() == 0:
        return float("nan")
    order = np.argsort(-s, kind="mergesort")
    y = y[order]
    precision = np.cumsum(y) / np.arange(1, len(y) + 1)
    return float((precision * y).sum() / y.sum())


def step_report(y: np.ndarray, s: np.ndarray, thr: float) -> dict:
    pred = s >= thr
    tp = int((pred & (y == 1)).sum())
    fn = int((~pred & (y == 1)).sum())
    fp = int((pred & (y == 0)).sum())
    return {"threshold": thr, "recall": tp / max(1, tp + fn), "falseNegativeRate": fn / max(1, tp + fn), "precision": tp / max(1, tp + fp),
            "prAuc": average_precision(y, s), "brier": float(((s - y) ** 2).mean()) if len(y) else float("nan"), "positives": int(y.sum()), "n": int(len(y))}


def scenario_report(d: dict, s: np.ndarray, thr: float) -> dict:
    """Per (run, room): detected flashovers, lead times, false alarms on rooms that never flash over."""
    keys = list(zip(d["run"], d["room"]))
    groups: dict[tuple, list[int]] = {}
    for i, k in enumerate(keys):
        groups.setdefault(k, []).append(i)
    leads, missed, fa, quiet = [], [], 0, 0
    for k, idx in groups.items():
        idx = np.array(idx)
        flashed = (d["cens"][idx] == 0).any()
        alerted = idx[s[idx] >= thr]
        if flashed:
            fo = float(np.min(d["t"][idx][d["cens"][idx] == 0] + d["tff"][idx][d["cens"][idx] == 0]))
            if len(alerted):
                leads.append(fo - float(d["t"][alerted].min()))
            else:
                missed.append({"run": k[0], "room": k[1], "flashover_s": fo, "last": {n: float(d["X"][idx[-1], j]) for j, n in enumerate(FEATURE_NAMES)}})
        else:
            quiet += 1
            fa += int(len(alerted) > 0)
    n_fo = len(leads) + len(missed)
    a = np.array(leads) if leads else np.array([np.nan])
    return {"flashovers": n_fo, "detected": len(leads), "detectionRate": len(leads) / n_fo if n_fo else float("nan"),
            "medianLeadS": float(np.nanmedian(a)), "p10LeadS": float(np.nanpercentile(a, 10)) if leads else float("nan"),
            "quietRooms": quiet, "falseAlarmRooms": fa, "falseAlarmRate": fa / quiet if quiet else float("nan"),
            "missed": missed, "leads": [float(x) for x in leads]}


def full_report(d: dict, preds: dict[str, np.ndarray], thr: dict[str, float]) -> dict:
    out = {k: step_report(d["y30" if k == "p30" else "y60"], preds[k], thr[k]) for k in ("p30", "p60")}
    out["scenario"] = scenario_report(d, preds["p60"], thr["p60"])
    m = d["cens"] == 0
    out["tff"] = {"maeS": float(np.abs(preds["tff"][m] - d["tff"][m]).mean()) if m.any() else None, "n": int(m.sum())}
    return out


def plots(d: dict, preds: dict[str, np.ndarray], rep: dict, out_dir: Path, title: str) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    y, s = d["y60"], preds["p60"]
    if y.sum() > 0:
        order = np.argsort(-s)
        tp = np.cumsum(y[order])
        prec = tp / np.arange(1, len(y) + 1)
        rec = tp / y.sum()
        fig, ax = plt.subplots(figsize=(5.5, 4.2))
        ax.plot(rec, prec, color="#d93025", lw=2)
        ax.axvline(rep["p60"]["recall"], color="#5f6368", ls="--", lw=1)
        ax.set(xlabel="Rappel", ylabel="Précision", title=f"{title} : embrasement ≤ 60 s (PR-AUC {rep['p60']['prAuc']:.2f})", xlim=(0, 1), ylim=(0, 1.02))
        fig.tight_layout()
        p = out_dir / "pr_curve.png"
        fig.savefig(p, dpi=130)
        plt.close(fig)
        files.append(str(p))
    leads = rep["scenario"]["leads"]
    if leads:
        fig, ax = plt.subplots(figsize=(5.5, 4.2))
        ax.hist(leads, bins=20, color="#188038")
        ax.axvline(rep["scenario"]["medianLeadS"], color="#202124", ls="--", lw=1, label=f"médiane {rep['scenario']['medianLeadS']:.0f} s")
        ax.set(xlabel="Délai d'anticipation avant l'embrasement (s)", ylabel="Locaux", title=f"{title} : délai d'anticipation")
        ax.legend()
        fig.tight_layout()
        p = out_dir / "lead_times.png"
        fig.savefig(p, dpi=130)
        plt.close(fig)
        files.append(str(p))
    return files


def strip(rep: dict) -> dict:
    """The report without per-room lists, for metrics.json."""
    r = json.loads(json.dumps(rep))
    r["scenario"].pop("leads", None)
    r["scenario"]["missed"] = [{"run": m["run"], "room": m["room"], "flashover_s": m["flashover_s"]} for m in r["scenario"]["missed"]]
    return r


sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(Path(__file__).parent / "model"))
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True, help="directory for the report JSON and plots")
    args = ap.parse_args()
    model_dir = Path(args.model)
    metrics = json.loads((model_dir / "metrics.json").read_text(encoding="utf-8"))
    thr = {k: float(metrics["thresholds"][k]) for k in ("p30", "p60")}
    d = load_csv(args.data)
    preds = predict_all(load_models(model_dir), d["X"])
    rep = full_report(d, preds, thr)
    out = Path(args.out)
    files = plots(d, preds, rep, out, args.name)
    (out / "report.json").write_text(json.dumps({"name": args.name, "model": metrics.get("trainedOn"), **strip(rep), "plots": files}, indent=2) + "\n", encoding="utf-8")
    s = rep["scenario"]
    print(f"{args.name}: {s['detected']}/{s['flashovers']} flashovers detected, median lead {s['medianLeadS']:.0f} s, "
          f"false alarms {s['falseAlarmRooms']}/{s['quietRooms']} quiet rooms; per step p60 recall {rep['p60']['recall']:.2f}, PR-AUC {rep['p60']['prAuc']:.2f}")


if __name__ == "__main__":
    main()
