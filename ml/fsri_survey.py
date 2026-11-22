"""Survey of the UL FSRI compartment experiments: what each one reached. Prints a table and writes ml/data/fsri_survey.csv.

Upper layer = mean of the four quadrant thermocouples 0.3 m below the ceiling; ceiling = mean of the four 25 mm below.
Flashover proxy = first time the upper layer reaches config.json fire.flashoverC (600 °C), the same threshold as the label.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
DATA = ROOT / "data" / "raw" / "fsri-compartments-2018" / "01_Data"
FLASHOVER_C = json.loads((ROOT.parent / "data" / "config.json").read_text(encoding="utf-8"))["hypotheses"]["fire"]["flashoverC"]["value"]
QUADS = "ABCD"


def load(name: str) -> pd.DataFrame:
    df = pd.read_csv(DATA / f"{name}.csv")
    return df[df["Time"] >= 0].reset_index(drop=True)


def ceiling(df: pd.DataFrame) -> pd.Series:
    return df[[f"Quadrant {q} Temperature 25 mm Below Ceiling" for q in QUADS]].mean(axis=1)


def upper_layer(df: pd.DataFrame) -> pd.Series:
    return df[[f"Quadrant {q} Temperature 0.3 m Below Ceiling" for q in QUADS]].mean(axis=1)


sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252


def main() -> None:
    rows = []
    for f in sorted(DATA.glob("*.csv")):
        if f.name.endswith("_Events.csv"):
            continue
        name = f.stem
        fuel, door, loc, rep = name.split("_")
        df = load(name)
        ul = upper_layer(df)
        hit = df["Time"][ul >= FLASHOVER_C]
        hrr = df["Heat Release Rate"] if "Heat Release Rate" in df else pd.Series(dtype=float)
        rows.append({
            "experiment": name, "fuel": fuel, "door": door, "location": loc, "replicate": int(rep),
            "duration_s": int(df["Time"].max()),
            "max_hrr_kw": round(float(hrr.max()), 1) if len(hrr.dropna()) else None,
            "max_ceiling_c": round(float(ceiling(df).max()), 1),
            "max_upper_layer_c": round(float(ul.max()), 1),
            "flashover_s": int(hit.iloc[0]) if len(hit) else None,
        })
    out = pd.DataFrame(rows)
    out.to_csv(ROOT / "data" / "fsri_survey.csv", index=False)
    print(out.groupby(["fuel", "door"]).agg(n=("experiment", "size"), max_hrr=("max_hrr_kw", "max"), max_ul=("max_upper_layer_c", "max"),
                                            flashovers=("flashover_s", lambda s: int(s.notna().sum()))).to_string())
    print(f"\n{int(out['flashover_s'].notna().sum())} of {len(out)} experiments reach {FLASHOVER_C} °C in the upper layer")
    print(out[out["flashover_s"].notna()][["experiment", "max_hrr_kw", "max_upper_layer_c", "flashover_s"]].to_string(index=False))


if __name__ == "__main__":
    main()
