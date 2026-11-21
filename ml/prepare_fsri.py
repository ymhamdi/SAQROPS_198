"""UL FSRI compartment experiments (OBSERVED) → the long format ml/featurize.ts reads, for validating the model on real fires.

Each of the four quadrant thermocouples 25 mm below the ceiling becomes one heat detector: its temperature is passed
through the detector's thermal lag (RTI model, same parameters as the simulator in data/config.json; gas velocity from
Alpert's ceiling-jet correlation at the measured or set heat release, at config detectors.fsriRadiusM), so the signal
is DERIVED. Failure above 150 °C is applied by featurize.ts, exactly as in the simulator. Each run is cut at
suppression or burner off. Label (OBSERVED): first time the mean of the four thermocouples 0.3 m below the ceiling
reaches config fire.flashoverC (600 °C).

Writes ml/data/fsri_long.csv, fsri_labels.csv, fsri_meta.json, fsri_hrr.csv (heat release used, for the physics check).
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
DATA = ROOT / "data"
RAW = DATA / "raw" / "fsri-compartments-2018" / "01_Data"
H = json.loads((ROOT.parent / "data" / "config.json").read_text(encoding="utf-8"))["hypotheses"]
D = {k: v["value"] for k, v in H["detectors"].items()}
FLASHOVER_C = H["fire"]["flashoverC"]["value"]
CEILING_M = 2.4
SETPOINT_KW = {"100kWSB": 100.0, "100kW": 100.0, "250kW": 250.0, "500kW": 500.0}
QUADS = "ABCD"


def alpert_velocity(q_kw: float, h: float, r: float) -> float:
    """Ceiling-jet velocity, m/s (Alpert 1972), as in app/src/fire/correlations.ts."""
    if q_kw <= 0:
        return 0.0
    if r / h <= D["alpertVelRatio"]:
        return D["alpertVelNearK"] * (q_kw / h) ** (1 / 3)
    return D["alpertVelFarK"] * q_kw ** (1 / 3) * h**0.5 / r ** (5 / 6)


def detector(gas: np.ndarray, hrr: np.ndarray, ambient: float) -> np.ndarray:
    """Heat-detector element temperature from the gas temperature at the ceiling, 1 s steps (RTI model)."""
    out = np.empty_like(gas)
    te = ambient
    for k in range(len(gas)):
        u = max(D["minGasVelocityMs"], alpert_velocity(float(hrr[k]), CEILING_M, D["fsriRadiusM"]))
        te = gas[k] + (te - gas[k]) * math.exp(-math.sqrt(u) / D["rtiMs05"])
        out[k] = te
    return out


def cut_time(name: str, ignition: dt.datetime) -> float | None:
    ev = pd.read_csv(RAW / f"{name}_Events.csv")
    ends = [dt.datetime.strptime(t, "%Y-%m-%d-%H:%M:%S") for t, e in zip(ev["Time"], ev["Event"]) if e.strip() in ("Suppression", "Burner Off")]
    return (min(ends) - ignition).total_seconds() if ends else None


def main() -> None:
    long_rows = []
    labels = []
    hrr_rows = []
    for f in sorted(RAW.glob("*.csv")):
        if f.name.endswith("_Events.csv"):
            continue
        name = f.stem
        fuel, door, loc, rep = name.split("_")
        df = pd.read_csv(f)
        ign = pd.to_datetime(df.loc[df["Time"] == 0, "Timestamp"].iloc[0]).to_pydatetime()
        end = cut_time(name, ign)
        df = df[(df["Time"] >= 0) & ((df["Time"] <= end) if end is not None else True)].reset_index(drop=True)
        t = df["Time"].to_numpy(dtype=float)
        measured = df["Heat Release Rate"].to_numpy(dtype=float) if "Heat Release Rate" in df else np.full(len(df), np.nan)
        has_hrr = np.isfinite(measured).sum() > 0.8 * len(measured) and np.nanmax(measured) > 1
        hrr = np.nan_to_num(measured) if has_hrr else np.full(len(df), SETPOINT_KW.get(fuel, 0.0))
        hrr_source = "measured" if has_hrr else ("setpoint" if fuel in SETPOINT_KW else "none")
        ul = df[[f"Quadrant {q} Temperature 0.3 m Below Ceiling" for q in QUADS]].mean(axis=1).to_numpy()
        hit = np.nonzero(ul >= FLASHOVER_C)[0]
        labels.append((name, "room", int(t[hit[0]]) if len(hit) else ""))
        ambient = float(np.nanmean(df[[f"Quadrant {q} Temperature 25 mm Below Ceiling" for q in QUADS]].iloc[:5].to_numpy()))
        for q in QUADS:
            gas = df[f"Quadrant {q} Temperature 25 mm Below Ceiling"].interpolate(limit_direction="both").to_numpy(dtype=float)
            det = detector(gas, hrr, ambient)
            long_rows.extend((name, int(tk), "room", q, round(float(x), 2)) for tk, x in zip(t, det))
        for tk, qk, u in zip(t, hrr, ul):
            hrr_rows.append((name, int(tk), round(float(qk), 1), round(float(u), 1), hrr_source, door))
    # featurize.ts wants rows sorted by run then t.
    long_rows.sort(key=lambda r: (r[0], r[1]))
    with (DATA / "fsri_long.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["run_id", "t", "room", "detector_id", "temperature_C"])
        w.writerows(long_rows)
    with (DATA / "fsri_labels.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["run_id", "room", "flashover_s"])
        w.writerows(labels)
    with (DATA / "fsri_hrr.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["run_id", "t", "hrr_kw", "upper_layer_c", "hrr_source", "door"])
        w.writerows(hrr_rows)
    (DATA / "fsri_meta.json").write_text(json.dumps({"dataset": "UL FSRI fsri-compartments-2018", "status": "OBSERVED (detector signal DERIVED)", "adjacency": {"room": []}}, indent=2), encoding="utf-8")
    n_fo = sum(1 for l in labels if l[2] != "")
    print(f"FSRI: {len(labels)} runs, {n_fo} reach {FLASHOVER_C} °C, {len(long_rows)} detector readings")


if __name__ == "__main__":
    main()
