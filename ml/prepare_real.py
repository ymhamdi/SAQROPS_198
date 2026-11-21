"""Real experiments only (OBSERVED) → the long format ml/featurize.ts reads, for the v4 model (trained on real fires).

Three UL FSRI sets (ml/download.py fsri fsri2016 fsri2019):
  compartments-2018       one 3.7 × 3.7 × 2.4 m room, furniture or burner, door open or closed: 120 runs, 11 flashovers
  residential-gasburner-2016  gas burner in a single-story (250 kW) and a two-story (500 kW) house: 13 runs
  hvac-gasburner-2019     gas burner in a ranch house with a basement, HVAC off / on: 29 runs

Every room keeps the thermocouples 2 to 3 cm below its ceiling; each becomes a heat detector through the RTI lag model of
the simulator (data/config.json detectors.*; gas velocity from Alpert's ceiling jet at detectors.fsriRadiusM in the
burner room, detectors.minGasVelocityMs elsewhere), so the signal is DERIVED. Failure above detectors.failureC is applied
by featurize.ts, exactly as in the app. Label (OBSERVED): first time the thermocouple(s) 0.3 m below the ceiling (their
mean when there are several) reach fire.flashoverC. Each run is cut at burner off, gas stop or suppression. Rooms and
the doors between them were read from the floor plans of each set: see ml/data/REAL_SCHEMA.md.

Augmentation (config.json realData), from the measurements only: copy 0 is the experiment as instrumented (every ceiling
thermocouple, detectors.rtiMs05, no shift) and is the only copy ever used for evaluation; copies 1..n-1 keep 1 to
maxDetectorsPerRoom ceiling thermocouples per room at random, draw one RTI in [rtiMinMs05, rtiMaxMs05] and shift the
start of the record by 0..windowOffsetMaxS s. A copy keeps the experiment's configuration, so the cross-validation never
splits them.

Writes ml/data/real_long.csv, real_labels.csv, real_meta.json and real_runs.csv (run → set, experiment, configuration,
copy). Usage: python ml/prepare_real.py
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
DATA = ROOT / "data"
RAW = DATA / "raw"
H = json.loads((ROOT.parent / "data" / "config.json").read_text(encoding="utf-8"))["hypotheses"]
D = {k: v["value"] for k, v in H["detectors"].items()}
A = {k: v["value"] for k, v in H["realData"].items()}
FLASHOVER_C = H["fire"]["flashoverC"]["value"]
SEED = 42

sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252


@dataclass
class Room:
    dets: dict[str, np.ndarray]  # ceiling thermocouples, degC, 1 s grid
    upper: np.ndarray  # 0.3 m below the ceiling (mean), degC: the label
    burner: bool  # the fire is in this room (ceiling-jet velocity)
    ceiling_m: float


@dataclass
class Run:
    dataset: str
    experiment: str
    config: str
    t: np.ndarray  # integer seconds from ignition
    hrr: np.ndarray  # kW, for the ceiling-jet velocity in the burner room
    rooms: dict[str, Room] = field(default_factory=dict)


def alpert_velocity(q_kw: float, h: float, r: float) -> float:
    """Ceiling-jet velocity, m/s (Alpert 1972), as in app/src/fire/correlations.ts and ml/prepare_fsri.py."""
    if q_kw <= 0:
        return 0.0
    if r / h <= D["alpertVelRatio"]:
        return D["alpertVelNearK"] * (q_kw / h) ** (1 / 3)
    return D["alpertVelFarK"] * q_kw ** (1 / 3) * h**0.5 / r ** (5 / 6)


def detector(gas: np.ndarray, u: np.ndarray, ambient: float, rti: float) -> np.ndarray:
    """Heat-detector element temperature from the gas temperature at the ceiling, 1 s steps (RTI model)."""
    k = np.exp(-np.sqrt(u) / rti)
    out = np.empty_like(gas)
    te = ambient
    for i in range(len(gas)):
        te = gas[i] + (te - gas[i]) * k[i]
        out[i] = te
    return out


def on_grid(df: pd.DataFrame, cols: list[str], end: float | None) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Channels interpolated on a 1 s grid from ignition to the cut (the 2016 two-story house logs every 2 s)."""
    df = df[df["Time"] >= 0]
    if end is not None:
        df = df[df["Time"] <= end]
    t_src = df["Time"].to_numpy(dtype=float)
    t = np.arange(0, int(math.floor(t_src.max())) + 1, dtype=float)
    out = {}
    for c in cols:
        y = pd.to_numeric(df[c], errors="coerce").interpolate(limit_direction="both").to_numpy(dtype=float)
        out[c] = np.interp(t, t_src, y)
    return t, out


# ---------- UL FSRI 2018: one compartment ----------
C18 = RAW / "fsri-compartments-2018" / "01_Data"
SETPOINT_KW = {"100kWSB": 100.0, "100kW": 100.0, "250kW": 250.0, "500kW": 500.0}


def load_2018() -> list[Run]:
    runs = []
    for f in sorted(C18.glob("*.csv")):
        if f.name.endswith("_Events.csv"):
            continue
        name = f.stem
        fuel, door, loc, _rep = name.split("_")
        df = pd.read_csv(f)
        ign = pd.to_datetime(df.loc[df["Time"] == 0, "Timestamp"].iloc[0]).to_pydatetime()
        ev = pd.read_csv(C18 / f"{name}_Events.csv")
        ends = [dt.datetime.strptime(t, "%Y-%m-%d-%H:%M:%S") for t, e in zip(ev["Time"], ev["Event"]) if e.strip() in ("Suppression", "Burner Off")]
        end = (min(ends) - ign).total_seconds() if ends else None
        # Same cut and channels as ml/prepare_fsri.py, so copy 0 is the validation set the shipped model was scored on.
        df = df[(df["Time"] >= 0) & ((df["Time"] <= end) if end is not None else True)].reset_index(drop=True)
        t = df["Time"].to_numpy(dtype=float)
        measured = df["Heat Release Rate"].to_numpy(dtype=float) if "Heat Release Rate" in df else np.full(len(df), np.nan)
        has_hrr = np.isfinite(measured).sum() > 0.8 * len(measured) and np.nanmax(measured) > 1
        hrr = np.nan_to_num(measured) if has_hrr else np.full(len(df), SETPOINT_KW.get(fuel, 0.0))
        dets = {q: df[f"Quadrant {q} Temperature 25 mm Below Ceiling"].interpolate(limit_direction="both").to_numpy(dtype=float) for q in "ABCD"}
        upper = df[[f"Quadrant {q} Temperature 0.3 m Below Ceiling" for q in "ABCD"]].mean(axis=1).to_numpy()
        run = Run("compartments-2018", name, f"2018:{fuel}_{door}_{loc}", t, hrr)
        run.rooms["C18/room"] = Room(dets, upper, True, 2.4)
        runs.append(run)
    return runs


# ---------- UL FSRI 2016: two houses ----------
R16 = RAW / "fsri-residential-gasburner-2016"
HOUSE16 = {"Single_Story": ("R16S", "Living Room", 250.0), "Two_Story": ("R16T", "Family Room Center", 500.0)}


def load_2016() -> list[Run]:
    runs = []
    for folder, (tag, burner_room, kw) in HOUSE16.items():
        for f in sorted((R16 / "01_Data" / folder).glob("Gas_Burner_*.csv")):
            if f.name.endswith("_Events.csv"):
                continue
            name = f.stem
            df = pd.read_csv(f)
            ev = pd.read_csv(f.with_name(f"{name}_Events.csv"))
            when = {e.strip(): dt.datetime.strptime(t.strip(), "%Y-%m-%d-%H:%M:%S") for e, t in zip(ev["Event"], ev["Time"])}
            end = (when["Burner Off"] - when["Ignition"]).total_seconds() if "Burner Off" in when else None
            rooms = {}
            for c in df.columns:
                m = re.match(r"^(.*?)\s+Temperature 0\.02 m Below Ceiling$", c)
                if m and f"{m.group(1)} Temperature 0.3 m Below Ceiling".replace("  ", " ") in [x.replace("  ", " ") for x in df.columns]:
                    label = next(x for x in df.columns if x.replace("  ", " ") == f"{m.group(1)} Temperature 0.3 m Below Ceiling".replace("  ", " "))
                    rooms[m.group(1).strip()] = (c, label)
            t, ch = on_grid(df, [c for pair in rooms.values() for c in pair], end)
            exp = name.replace("Gas_Burner_", "")
            run = Run("residential-gasburner-2016", f"{folder}/{name}", f"2016:{folder}:{re.sub(r'R\d+$', '', exp)}", t, np.full(len(t), kw))
            for room, (det, label) in rooms.items():
                run.rooms[f"{tag}/{room}"] = Room({"tc": ch[det]}, ch[label], room == burner_room, 2.4)
            runs.append(run)
    return runs


# ---------- UL FSRI 2019: a house with a basement ----------
H19 = RAW / "fsri-hvac-gasburner-2019"
FLOOR19 = ["Living Room", "Dining Room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bedroom 3"]


def load_2019() -> list[Run]:
    info = pd.read_csv(H19 / "02_Info" / "Info_Gas_Burner.csv")
    cfg_cols = ["Fire_Location", "MFC_Voltage", "BR1 Door", "BR1 Transfer", "BR3 Transfer", "Basement Door", "Front Door"]
    nominal: dict[str, list[float]] = {}
    loaded = []
    for _, row in info.iterrows():
        name = row["Test_Name"]
        df = pd.read_csv(H19 / "01_Data" / f"{name}.csv")
        ev = pd.read_csv(H19 / "01_Data" / "Events" / f"{name}_Events.csv")
        ev_t = {str(e).strip(): float(t) for t, e in zip(ev["Time"], ev["Event"])}
        ign = ev_t.get("Ignition", 0.0)  # event times count from the pilot; data Time counts from ignition
        stops = [ev_t[e] - ign for e in ("Stop Gas", "Burner Out", "Suppression") if e in ev_t]
        end = min(stops) if stops else None
        cols, rooms = [], {}
        for r in FLOOR19:
            det, label = f"{r} Temperature 2.41 m Above Floor", f"{r} Temperature 2.13 m Above Floor"
            if det in df and label in df:
                rooms[f"H19/{r}"] = ([det], [label], 2.44, r == row["Fire_Location"])
        bdet = [f"Basement {q} Quadrant Temperature 2.72 m Above Floor" for q in "ABCD"]
        blab = [f"Basement {q} Quadrant Temperature 2.44 m Above Floor" for q in "ABCD"]
        if all(c in df for c in bdet + blab):
            rooms["H19/Basement"] = (bdet, blab, 2.74, row["Fire_Location"] == "Basement")
        for d_, l_, _, _ in rooms.values():
            cols += d_ + l_
        has_hrr = "HRR" in df and pd.to_numeric(df.loc[df["Time"] >= 0, "HRR"], errors="coerce").gt(1).mean() > 0.5
        if has_hrr:
            cols.append("HRR")
        t, ch = on_grid(df, cols, end)
        mfc = str(row["MFC_Voltage"]).split("|")[0].lstrip("0")
        q = float(np.median(ch["HRR"][ch["HRR"] > 1])) if has_hrr else None
        if q:
            nominal.setdefault(mfc, []).append(q)
        config = "2019:" + "|".join(str(row[c]) for c in cfg_cols)
        loaded.append((name, config, mfc, q, t, ch, rooms))
    runs = []
    for name, config, mfc, q, t, ch, rooms in loaded:
        kw = q if q else float(np.median(nominal.get(mfc, [100.0])))  # runs without a HRR channel: same burner flow
        run = Run("hvac-gasburner-2019", name, config, t, np.full(len(t), kw))
        for room, (dets, labels, ceiling, burner) in rooms.items():
            run.rooms[room] = Room({c.split(" Temperature")[0].split()[-2] if "Quadrant" in c else "tc": ch[c] for c in dets}, np.mean([ch[c] for c in labels], axis=0), burner, ceiling)
        runs.append(run)
    return runs


# Rooms that share a door or an opening, read from the floor plans (ml/data/REAL_SCHEMA.md). A hallway without a
# thermocouple tree is treated as transparent: the rooms around it are neighbours.
ADJ_EDGES = {
    "R16S": [("Living Room", "Kitchen"), ("Living Room", "Dining Room"), ("Living Room", "Breakfast Area"), ("Living Room", "Hallway"),
             ("Kitchen", "Breakfast Area"), ("Breakfast Area", "Dining Room"), ("Hallway", "Bedroom 1"), ("Hallway", "Bedroom 2"), ("Hallway", "Bedroom 3")],
    "R16T": [("Family Room Center", "Kitchen"), ("Family Room Center", "Den"), ("Family Room Center", "Foyer"), ("Family Room Center", "Living Room"),
             ("Family Room Center", "End Hall"), ("Kitchen", "Under Hall"), ("Under Hall", "Laundry"), ("Under Hall", "Dining"), ("Under Hall", "Foyer"),
             ("Foyer", "Dining"), ("Foyer", "Living Room"), ("Foyer", "Mid Hall"), ("Mid Hall", "End Hall"), ("Mid Hall", "Bedroom 1"),
             ("Mid Hall", "Bedroom 4"), ("End Hall", "Bedroom 2"), ("End Hall", "Bedroom 3")],
    "H19": [("Living Room", "Dining Room"), ("Living Room", "Kitchen"), ("Dining Room", "Kitchen"), ("Living Room", "Bedroom 1"), ("Living Room", "Bedroom 2"),
            ("Living Room", "Bedroom 3"), ("Bedroom 1", "Bedroom 2"), ("Bedroom 1", "Bedroom 3"), ("Bedroom 2", "Bedroom 3"), ("Living Room", "Basement"),
            ("Kitchen", "Basement")],
}


def adjacency(rooms: set[str]) -> dict[str, list[str]]:
    adj: dict[str, set[str]] = {r: set() for r in rooms}
    for tag, edges in ADJ_EDGES.items():
        for a, b in edges:
            ra, rb = f"{tag}/{a}", f"{tag}/{b}"
            if ra in adj and rb in adj:
                adj[ra].add(rb)
                adj[rb].add(ra)
    missing = [r for r in rooms if not adj[r] and not r.startswith("C18/")]
    if missing:
        raise SystemExit(f"rooms without neighbours (check ADJ_EDGES against the channel names): {missing}")
    return {r: sorted(v) for r, v in sorted(adj.items())}


def write_copy(w, run: Run, copy: int, rng: np.random.Generator, labels_out: list, runs_out: list) -> None:
    run_id = f"{run.dataset}~{run.experiment}~c{copy}"
    rti = D["rtiMs05"] if copy == 0 else float(rng.uniform(A["rtiMinMs05"], A["rtiMaxMs05"]))
    off = 0 if copy == 0 else int(rng.integers(0, A["windowOffsetMaxS"] + 1))
    series = []
    for room, r in run.rooms.items():
        names = sorted(r.dets)
        if copy > 0:
            n = int(rng.integers(1, min(A["maxDetectorsPerRoom"], len(names)) + 1))
            names = sorted(rng.choice(names, size=n, replace=False).tolist())
        u = np.array([max(D["minGasVelocityMs"], alpert_velocity(float(q), r.ceiling_m, D["fsriRadiusM"])) for q in run.hrr]) if r.burner else np.full(len(run.t), D["minGasVelocityMs"])
        ambient = float(np.nanmean([r.dets[n][:5].mean() for n in sorted(r.dets)]))
        for n in names:
            series.append((room, n, detector(r.dets[n], u, ambient, rti)))
        hit = np.nonzero(r.upper >= FLASHOVER_C)[0]
        fo = int(run.t[hit[0]]) - off if len(hit) else ""
        labels_out.append((run_id, room, fo))
    keep = run.t >= off
    for k in np.nonzero(keep)[0]:
        tk = int(run.t[k]) - off
        for room, n, s in series:
            w.writerow((run_id, tk, room, n, f"{s[k]:.2f}"))
    n_fo = sum(1 for l in labels_out if l[0] == run_id and l[2] != "")
    runs_out.append((run_id, run.dataset, run.experiment, run.config, copy, round(rti, 1), off, n_fo))


def main() -> None:
    sets = [("compartments-2018", load_2018, A["copiesCompartments2018"]), ("residential-gasburner-2016", load_2016, A["copiesResidential"]),
            ("hvac-gasburner-2019", load_2019, A["copiesResidential"])]
    rng = np.random.default_rng(SEED)
    labels_out, runs_out, all_rooms = [], [], set()
    with (DATA / "real_long.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["run_id", "t", "room", "detector_id", "temperature_C"])
        for name, load, copies in sets:
            runs = load()
            n_rooms = sum(len(r.rooms) for r in runs)
            peaks = [float(np.nanmax(room.upper)) for r in runs for room in r.rooms.values()]
            print(f"{name}: {len(runs)} runs, {len(set(r.config for r in runs))} configurations, {n_rooms} rooms, "
                  f"upper layer max {max(peaks):.0f} °C, {sum(p >= FLASHOVER_C for p in peaks)} rooms reach {FLASHOVER_C} °C")
            for run in runs:
                all_rooms.update(run.rooms)
                for c in range(int(copies)):
                    write_copy(w, run, c, rng, labels_out, runs_out)
    with (DATA / "real_labels.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["run_id", "room", "flashover_s"])
        w.writerows(labels_out)
    with (DATA / "real_runs.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["run_id", "dataset", "experiment", "config", "copy", "rti", "offset_s", "flashovers"])
        w.writerows(runs_out)
    meta = {"dataset": "UL FSRI compartments-2018, residential-gasburner-2016, hvac-gasburner-2019", "status": "OBSERVED (detector signal DERIVED)", "adjacency": adjacency(all_rooms)}
    (DATA / "real_meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    base = [r for r in runs_out if r[4] == 0]
    print(f"written: {len(runs_out)} runs ({len(base)} real, {len(runs_out) - len(base)} augmented copies), "
          f"{sum(1 for l in labels_out if l[2] != '' and l[0].endswith('~c0'))} real flashovers, {len(all_rooms)} rooms")


if __name__ == "__main__":
    main()
