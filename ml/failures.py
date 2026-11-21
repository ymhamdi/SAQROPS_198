"""What the missed flashovers have in common: writes ml/report/failures.md.

Reads a model directory's metrics.json (the internal test split's missed rooms, and those of each external set) and,
for plan B data, the per-room description ml/generate.ts writes next to the CSV (*.meta.csv): fire growth, fuel limit,
ignition room or neighbour, open doors. Compares the missed rooms with every room that flashed over in the test split.

  python ml/failures.py --model ml/runs/planB-v3 --meta ml/data/scenarios_v3.meta.csv
"""

from __future__ import annotations

import argparse
import json
import sys
import zlib
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent

sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252


def share(series: pd.Series) -> str:
    c = Counter(series)
    n = sum(c.values())
    return ", ".join(f"{k} {100 * v / n:.0f} %" for k, v in sorted(c.items(), key=lambda kv: -kv[1]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--out", default=str(ROOT / "report" / "failures.md"))
    args = ap.parse_args()
    m = json.loads((Path(args.model) / "metrics.json").read_text(encoding="utf-8"))
    meta = pd.read_csv(args.meta)
    tag = Path(args.meta).name.replace(".meta.csv", "")
    meta["key"] = tag + ":" + meta["run"].astype(str)
    meta["split"] = [("train" if h < 70 else "val" if h < 85 else "test") for h in (zlib.crc32(k.encode()) % 100 for k in meta["key"])]
    meta["fuel"] = meta["peak_kw"].apply(lambda x: "limité par le combustible" if pd.notna(x) else "limité par la ventilation")
    meta["origin"] = meta["fire_room"].map({1: "local du départ de feu", 0: "local voisin (propagation)"})
    flashed = meta[(meta["split"] == "test") & meta["flashed_s"].notna()]
    missed_keys = {(x["run"], str(x["room"])) for x in m["test"]["scenario"]["missed"]}
    missed = flashed[[((k, str(r)) in missed_keys) for k, r in zip(flashed["key"], flashed["room"])]]
    s = m["test"]["scenario"]

    lines = [
        "# Embrasements manqués",
        "",
        f"Modèle : {m['trainedOn']} (`{args.model}`), seuil P(≤ 60 s) {m['thresholds']['p60']:.3f} fixé en validation pour un rappel ≥ 0,95 par pas de temps.",
        "Un embrasement est manqué quand l'alerte à 60 s ne s'est levée à aucun moment avant lui.",
        "",
        "## Test interne (données plan B, découpage par scénario)",
        "",
        f"{s['detected']} embrasements détectés sur {s['flashovers']} ; {len(missed)} manqués. Délai d'anticipation médian {s['medianLeadS']:.0f} s, P10 {s['p10LeadS']:.0f} s. "
        f"Fausses alertes : {s['falseAlarmRooms']} locaux sur {s['quietRooms']} qui ne s'embrasent jamais.",
        "",
        "| Caractéristique | Embrasements manqués | Tous les embrasements du test |",
        "|---|---|---|",
        f"| Vitesse de croissance du feu | {share(missed['growth'])} | {share(flashed['growth'])} |",
        f"| Type de feu | {share(missed['fuel'])} | {share(flashed['fuel'])} |",
        f"| Local | {share(missed['origin'])} | {share(flashed['origin'])} |",
        f"| Portes ouvertes du local (fin) | {share(missed['doors_open'].astype(str) + ' porte(s)')} | {share(flashed['doors_open'].astype(str) + ' porte(s)')} |",
        f"| Parois | {share(missed['walls'])} | {share(flashed['walls'])} |",
        "",
    ]
    last = [x for x in m["test"]["scenario"]["missed"]]
    if missed.shape[0]:
        lines += [f"Instant moyen de l'embrasement manqué : {missed['flashed_s'].mean():.0f} s après le début du scénario (tous : {flashed['flashed_s'].mean():.0f} s).", ""]
    for name, e in m.get("external", {}).items():
        es = e["scenario"]
        lines += [f"## {name}", "", f"{es['detected']} embrasements détectés sur {es['flashovers']} ; délai médian {es['medianLeadS']:.0f} s. "
                  f"Fausses alertes : {es['falseAlarmRooms']} locaux sur {es['quietRooms']} qui ne s'embrasent jamais.", ""]
        if es["missed"]:
            lines += ["Manqués : " + ", ".join(f"`{x['run'].split(':', 1)[1]}` (embrasement à {x['flashover_s']:.0f} s)" for x in es["missed"]), ""]
    lines += ["Généré par `ml/failures.py` ; ne pas éditer à la main.", ""]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:20]))


if __name__ == "__main__":
    main()
