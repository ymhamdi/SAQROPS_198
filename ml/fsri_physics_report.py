"""RMSE and plots of the fire engine against the UL FSRI measurements (ml/fsri_physics.ts output).

Writes ml/report/fsri_physics/summary.json and a few representative plots (predicted SIMULATED vs measured OBSERVED).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
OUT = ROOT / "report" / "fsri_physics"
SHOW = ["500kW_Open_Center_1", "250kW_Open_Corner_1", "Overstuffed_Open_Center_1", "RedAccent_Open_Corner_1", "500kW_Closed_Center_1", "100kW_Closed_Back_1"]

sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(ROOT / "data" / "fsri_physics.csv")
    df["fuel"] = df["run_id"].str.split("_").str[0]
    per = df.groupby("run_id").apply(lambda g: pd.Series({
        "fuel": g["fuel"].iloc[0], "door": g["door"].iloc[0], "hrr_source": g["hrr_source"].iloc[0],
        "rmse_c": float(np.sqrt(((g["predicted_c"] - g["measured_c"]) ** 2).mean())),
        "bias_c": float((g["predicted_c"] - g["measured_c"]).mean()),
        "peak_measured_c": float(g["measured_c"].max()), "peak_predicted_c": float(g["predicted_c"].max()),
    }), include_groups=False)
    groups = per.groupby(["fuel", "door"]).agg(n=("rmse_c", "size"), rmse_c=("rmse_c", "mean"), bias_c=("bias_c", "mean"),
                                               peak_measured_c=("peak_measured_c", "mean"), peak_predicted_c=("peak_predicted_c", "mean")).round(1)
    print(groups.to_string())
    open_ = per[per["door"] == "Open"]
    summary = {
        "what": "Our fire engine's hot-layer temperature (SIMULATED) vs the mean of the four UL FSRI thermocouples 0.3 m below the ceiling (OBSERVED), same room and heat release",
        "experiments": int(len(per)),
        "rmseOpenDoorC": round(float(open_["rmse_c"].mean()), 1),
        "rmseClosedDoorC": round(float(per[per["door"] == "Closed"]["rmse_c"].mean()), 1),
        "groups": groups.reset_index().to_dict(orient="records"),
    }
    files = []
    for run in SHOW:
        g = df[df["run_id"] == run]
        if g.empty:
            continue
        fig, ax = plt.subplots(figsize=(5.5, 3.8))
        ax.plot(g["t"], g["measured_c"], color="#202124", lw=2, label="mesure UL FSRI (OBSERVED)")
        ax.plot(g["t"], g["predicted_c"], color="#d93025", lw=2, ls="--", label="moteur PNR (SIMULATED)")
        ax.axhline(600, color="#9aa0a6", lw=1, ls=":")
        r = per.loc[run]
        ax.set(xlabel="Temps depuis l'allumage (s)", ylabel="Couche chaude (°C)", title=f"{run} : RMSE {r['rmse_c']:.0f} °C")
        ax.legend(fontsize=8)
        fig.tight_layout()
        p = OUT / f"{run}.png"
        fig.savefig(p, dpi=120)
        plt.close(fig)
        files.append(str(p.relative_to(ROOT.parent)).replace("\\", "/"))
    summary["plots"] = files
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"open door RMSE {summary['rmseOpenDoorC']} °C, closed door RMSE {summary['rmseClosedDoorC']} °C over {summary['experiments']} experiments")


if __name__ == "__main__":
    main()
