"""Model v4: trained on real UL FSRI experiments only (ml/prepare_real.py → ml/featurize.ts), judged honestly.

Unit of the split = the CONFIGURATION (fuel × door × position for 2018, experiment number for 2016, fire location ×
burner flow × door states for 2019), never the run or the time step: repeats of one configuration and every augmented
copy of a run stay in the same group. Outer loop: 4 grouped folds (the 11 flashovers sit in 6 configurations, 3-3-2-1-1-1:
five folds of two or more cannot be made), stratified so that each test fold holds at least two
flashovers. Inner loop (nested): 3 grouped folds inside the training part give out-of-fold predictions on its runs as
instrumented; the decision thresholds are the highest that keep recall >= 0.95 per time step on THOSE predictions,
never on the test fold. Training uses every copy (augmented) of the training configurations; evaluation only copy 0
(the experiment as instrumented). Hyperparameters are fixed (no early stopping, so nothing is tuned on a test fold).

The shipped v1 (ml/model), the v3 export (ml/runs/planB-v3, if present) and the simple rule (30 s slope + 10 × share of
failed detectors) are scored on exactly the same rows: v1 and v3 with their own shipped thresholds, the rule with a
threshold chosen on the training part of each fold. 95 % confidence intervals: bootstrap over configurations (the same
resamples for every model, so differences are paired). Then the final v4 is trained on all the real data, with the
median of the outer folds' thresholds, and exported to ml/model-v4 (golden.csv included for the R8 parity test).

  python ml/train_real.py [--v3 ml/runs/planB-v3] [--boot 1000]
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

from evaluate import average_precision, load_csv, load_models, predict_all
from features import CONTRACT, FEATURE_NAMES
from train import threshold_for_recall, write_golden

ROOT = Path(__file__).parent
DATA = ROOT / "data"
TARGET_RECALL = 0.95
SEED = 42
OUTER, INNER = 4, 3  # 11 flashovers in 6 configurations (3, 3, 2, 1, 1, 1): 4 is the most folds that keep >= 2 in each
ROUNDS = 300
PARAMS = {"max_depth": 4, "eta": 0.05, "subsample": 0.8, "colsample_bytree": 0.8, "min_child_weight": 5, "seed": SEED, "nthread": 8, "tree_method": "hist", "device": "cpu"}
J30, JF = FEATURE_NAMES.index("self_slope_30"), FEATURE_NAMES.index("self_frac_failed")

sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252


def rule_score(X: np.ndarray) -> np.ndarray:
    """The simple rule of ml/train.py: the room's 30 s slope plus 10 × the share of failed detectors."""
    return np.nan_to_num(X[:, J30]) + 10 * np.nan_to_num(X[:, JF])


def fit(X: np.ndarray, y: np.ndarray, objective: str) -> xgb.Booster:
    p = dict(PARAMS, objective=objective)
    if objective == "binary:logistic":
        pos = max(1, int(y.sum()))
        p["scale_pos_weight"] = (len(y) - pos) / pos
    return xgb.train(p, xgb.DMatrix(X, label=y, missing=np.nan, feature_names=FEATURE_NAMES), num_boost_round=ROUNDS)


def scores(m: xgb.Booster, X: np.ndarray) -> np.ndarray:
    return m.predict(xgb.DMatrix(X, missing=np.nan, feature_names=FEATURE_NAMES))


def folds(configs: list[str], pos: dict[str, int], weight: dict[str, int], k: int) -> dict[str, int]:
    """Greedy stratified grouping: configurations with flashovers spread first (most first), then the others by size."""
    fold_of, npos, nw = {}, [0] * k, [0] * k
    for c in sorted([c for c in configs if pos[c]], key=lambda c: (-pos[c], c)):
        f = min(range(k), key=lambda i: (npos[i], nw[i]))
        fold_of[c], npos[f], nw[f] = f, npos[f] + pos[c], nw[f] + weight[c]
    for c in sorted([c for c in configs if not pos[c]], key=lambda c: (-weight[c], c)):
        f = min(range(k), key=lambda i: nw[i])
        fold_of[c], nw[f] = f, nw[f] + weight[c]
    return fold_of


def per_room(d: dict, alert: np.ndarray, idx: np.ndarray) -> list[dict]:
    """Per (run, room) of the given rows: did it flash over, was it announced, lead time, false alarm."""
    out, groups = [], {}
    for i in idx:
        groups.setdefault((d["run"][i], d["room"][i]), []).append(i)
    for (run, room), ii in groups.items():
        ii = np.array(ii)
        fl = d["cens"][ii] == 0
        flashed = bool(fl.any())
        al = ii[alert[ii]]
        rec = {"run": run, "room": room, "config": d["config"][ii[0]], "dataset": d["dataset"][ii[0]], "flashed": flashed, "alerted": len(al) > 0, "lead": math.nan}
        if flashed:
            fo = float(np.min(d["t"][ii][fl] + d["tff"][ii][fl]))
            rec["flashover_s"] = fo
            if len(al):
                rec["lead"] = fo - float(d["t"][al].min())
        out.append(rec)
    return out


def room_max(d: dict, idx: np.ndarray, s: np.ndarray) -> tuple[list[float], list[float]]:
    """Highest score of each room before its flashover (rows stop at the flashover): flashover rooms, quiet rooms."""
    best: dict[tuple, list] = {}
    for i in idx:
        key = (d["run"][i], d["room"][i])
        b = best.setdefault(key, [-np.inf, False])
        b[0] = max(b[0], float(s[i]))
        b[1] = b[1] or d["cens"][i] == 0
    return [v for v, f in best.values() if f], [v for v, f in best.values() if not f]


def run_threshold(d: dict, idx: np.ndarray, s: np.ndarray) -> float:
    """Secondary operating point: the highest threshold that still announces >= 95 % of the flashover rooms at least once."""
    fl, _ = room_max(d, idx, s)
    if not fl:
        return 0.5
    fl = sorted(fl, reverse=True)
    return float(fl[max(0, math.ceil(TARGET_RECALL * len(fl)) - 1)])


def metrics(recs: list[dict], y: np.ndarray, s: np.ndarray, a: np.ndarray, prob: bool) -> dict:
    fl = [r for r in recs if r["flashed"]]
    quiet = [r for r in recs if not r["flashed"]]
    leads = np.array([r["lead"] for r in fl if r["alerted"]])
    tp, fn, fp = int((a & (y == 1)).sum()), int((~a & (y == 1)).sum()), int((a & (y == 0)).sum())
    return {
        "flashovers": len(fl), "detected": sum(r["alerted"] for r in fl), "detection": sum(r["alerted"] for r in fl) / len(fl) if fl else math.nan,
        "medianLeadS": float(np.median(leads)) if len(leads) else math.nan, "p10LeadS": float(np.percentile(leads, 10)) if len(leads) else math.nan,
        "quiet": len(quiet), "falseAlarms": sum(r["alerted"] for r in quiet), "falseAlarmRate": sum(r["alerted"] for r in quiet) / len(quiet) if quiet else math.nan,
        "recall": tp / (tp + fn) if tp + fn else math.nan, "precision": tp / (tp + fp) if tp + fp else math.nan,
        "prAuc": average_precision(y, s) if y.sum() else math.nan, "brier": float(((s - y) ** 2).mean()) if prob and len(y) else math.nan,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(DATA / "real_features.csv"))
    ap.add_argument("--runs", default=str(DATA / "real_runs.csv"))
    ap.add_argument("--v1", default=str(ROOT / "model-v1"))
    ap.add_argument("--v3", default=str(ROOT / "runs" / "planB-v3"))
    ap.add_argument("--out", default=str(ROOT / "model-v4"))
    ap.add_argument("--report", default=str(ROOT / "report" / "v4-real"))
    ap.add_argument("--boot", type=int, default=1000)
    ap.add_argument("--ship", default=None, help="also write the final v4 here (ml/model) with the SECONDARY per-run thresholds")
    args = ap.parse_args()
    out, rep_dir = Path(args.out), Path(args.report)
    out.mkdir(parents=True, exist_ok=True)
    rep_dir.mkdir(parents=True, exist_ok=True)

    info = {}
    with open(args.runs, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            info[r["run_id"]] = r
    d = load_csv([args.data])
    raw_run = np.array([r.split(":", 1)[1] for r in d["run"]])
    d["config"] = np.array([info[r]["config"] for r in raw_run])
    d["dataset"] = np.array([info[r]["dataset"] for r in raw_run])
    copy = np.array([int(info[r]["copy"]) for r in raw_run])
    base = copy == 0
    configs = sorted(set(d["config"]))
    pos = {c: 0 for c in configs}
    weight = {c: 0 for c in configs}
    for r in info.values():
        if r["copy"] == "0":
            pos[r["config"]] += int(r["flashovers"])
            weight[r["config"]] += 1
    print(f"rows {len(d['t'])} ({base.sum()} as instrumented), {len(set(raw_run))} runs, {len(configs)} configurations, "
          f"{sum(pos.values())} real flashovers in {sum(1 for c in configs if pos[c])} configurations")

    outer = folds(configs, pos, weight, OUTER)
    fold = np.array([outer[c] for c in d["config"]])
    for k in range(OUTER):
        print(f"  fold {k}: {sum(1 for c in configs if outer[c] == k)} configurations, {sum(pos[c] for c in configs if outer[c] == k)} flashovers")
    assert all(sum(pos[c] for c in configs if outer[c] == k) >= 2 for k in range(OUTER)), "a test fold has fewer than 2 flashovers"

    n = len(d["t"])
    s4 = {"p30": np.full(n, np.nan), "p60": np.full(n, np.nan)}
    a4 = {"p30": np.zeros(n, bool), "p60": np.zeros(n, bool)}
    srule, arule = rule_score(d["X"]), np.zeros(n, bool)
    a4run = np.zeros(n, bool)
    fold_thr = []
    for k in range(OUTER):
        tr_cfg = [c for c in configs if outer[c] != k]
        inner = folds(tr_cfg, pos, weight, INNER)
        oof = {"p30": [], "p60": [], "y30": [], "y60": []}
        oofs = {"p30": np.full(n, np.nan), "p60": np.full(n, np.nan)}
        for j in range(INNER):
            itr = np.array([(c in inner and inner[c] != j) for c in d["config"]])
            ite = np.array([(c in inner and inner[c] == j) for c in d["config"]]) & base
            for key, ycol in (("p30", "y30"), ("p60", "y60")):
                m = fit(d["X"][itr], d[ycol][itr], "binary:logistic")
                sc = scores(m, d["X"][ite])
                oof[key].append(sc)
                oof[ycol].append(d[ycol][ite])
                oofs[key][ite] = sc
        thr = {key: threshold_for_recall(np.concatenate(oof["y" + key[1:]]), np.concatenate(oof[key]), TARGET_RECALL) for key in ("p30", "p60")}
        thr_run = {key: run_threshold(d, np.nonzero(np.isfinite(oofs[key]))[0], oofs[key]) for key in ("p30", "p60")}
        tr = fold != k
        te = (fold == k) & base
        for key, ycol in (("p30", "y30"), ("p60", "y60")):
            m = fit(d["X"][tr], d[ycol][tr], "binary:logistic")
            s4[key][te] = scores(m, d["X"][te])
            a4[key][te] = s4[key][te] >= thr[key]
        a4run[te] = s4["p60"][te] >= thr_run["p60"]
        thr_rule = threshold_for_recall(d["y60"][tr & base], srule[tr & base], TARGET_RECALL)
        arule[te] = srule[te] >= thr_rule
        fold_thr.append({"fold": k, "v4": thr, "v4PerRun": thr_run, "rule": thr_rule})
        print(f"  fold {k}: thresholds p30 {thr['p30']:.3f} p60 {thr['p60']:.3f}, per run p30 {thr_run['p30']:.3f} p60 {thr_run['p60']:.3f}, rule {thr_rule:.3f}")

    # The shipped models, as they are, on the same rows.
    models = {"v4 (réel seul)": (s4["p60"], a4["p60"], True), "v4, seuil par essai (secondaire)": (s4["p60"], a4run, True)}
    for label, path in (("v1 (simulateur, livrée)", args.v1), ("v3 (simulateur, non livrée)", args.v3)):
        p = Path(path)
        if (p / "metrics.json").exists():
            mt = json.loads((p / "metrics.json").read_text(encoding="utf-8"))
            sc = predict_all(load_models(p), d["X"])["p60"]
            models[label] = (sc, sc >= float(mt["thresholds"]["p60"]), True)
        else:
            print(f"  {label}: no export at {p}, skipped")
    models["règle simple (pente + pannes)"] = (srule, arule, False)

    idx_base = np.nonzero(base)[0]
    subsets = {"toutes les données réelles": idx_base, "FSRI 2018 (un local)": idx_base[d["dataset"][idx_base] == "compartments-2018"],
               "maisons 2016 et 2019 (négatifs)": idx_base[d["dataset"][idx_base] != "compartments-2018"]}
    by_cfg = {c: idx_base[d["config"][idx_base] == c] for c in configs}
    rng = np.random.default_rng(SEED)
    results = {}
    for sname, idx in subsets.items():
        cfgs = sorted(set(d["config"][idx]))
        results[sname] = {}
        recs_all = {}
        for mname, (s, a, prob) in models.items():
            recs = per_room(d, a, idx)
            recs_all[mname] = recs
            results[sname][mname] = {"point": metrics(recs, d["y60"][idx], s[idx], a[idx], prob)}
        # paired bootstrap over configurations
        rec_by_cfg = {m: {c: [r for r in recs_all[m] if r["config"] == c] for c in cfgs} for m in models}
        boots = {m: [] for m in models}
        for _ in range(args.boot):
            pick = rng.choice(cfgs, size=len(cfgs), replace=True)
            ii = np.concatenate([by_cfg[c] for c in pick])
            for mname, (s, a, prob) in models.items():
                recs = [r for c in pick for r in rec_by_cfg[mname][c]]
                boots[mname].append(metrics(recs, d["y60"][ii], s[ii], a[ii], prob))
        for mname in models:
            ci = {}
            for key in results[sname][mname]["point"]:
                vals = np.array([b[key] for b in boots[mname]], dtype=float)
                vals = vals[np.isfinite(vals)]
                ci[key] = [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))] if len(vals) else [math.nan, math.nan]
            results[sname][mname]["ci95"] = ci
        if "v1 (simulateur, livrée)" in models:
            for m4, short in (("v4 (réel seul)", "v4"), ("v4, seuil par essai (secondaire)", "v4 seuil par essai")):
                for key, label in (("falseAlarmRate", "taux de fausses alertes"), ("detection", "embrasements annoncés")):
                    dd = np.array([b[key] for b in boots[m4]]) - np.array([b[key] for b in boots["v1 (simulateur, livrée)"]])
                    dd = dd[np.isfinite(dd)]
                    results[sname][f"{short} − v1, {label}"] = [float(np.percentile(dd, 2.5)), float(np.percentile(dd, 97.5))] if len(dd) else None
        # Threshold-free comparison: false alarms of each model at the threshold that announces every flashover of the
        # subset (chosen on the test labels: an oracle, not an operating point; same rule for every model).
        fl_any = any(r["flashed"] for r in recs_all["v4 (réel seul)"])
        if fl_any:
            results.setdefault("_oracle", {})[sname] = {}
            for mname, (s, _, _) in models.items():
                if mname == "v4, seuil par essai (secondaire)":
                    continue
                fl, quiet = room_max(d, idx, s)
                thr_o = min(fl)
                results["_oracle"][sname][mname] = {"falseAlarms": int(sum(q >= thr_o for q in quiet)), "quiet": len(quiet)}
        if sname == "toutes les données réelles":
            results["_rooms"] = {m: [{k: (v if not (isinstance(v, float) and math.isnan(v)) else None) for k, v in r.items()} for r in recs_all[m] if r["flashed"]] for m in models}

    # Final v4: every real run and copy; thresholds = median of the outer folds'.
    final = {"p30": fit(d["X"], d["y30"], "binary:logistic"), "p60": fit(d["X"], d["y60"], "binary:logistic"), "tff": fit(d["X"], d["tff"], "reg:squarederror")}
    thr_final = {key: float(np.median([f["v4"][key] for f in fold_thr])) for key in ("p30", "p60")}
    thr_final_run = {key: float(np.median([f["v4PerRun"][key] for f in fold_thr])) for key in ("p30", "p60")}
    for key, m in final.items():
        m.save_model(str(out / CONTRACT["models"][key]["file"]))
    write_golden(final, d["X"][base], out)
    meta = {
        "status": "TRAINED", "trainedOn": "essais réels UL FSRI (2018, 2016, 2019), 162 essais",
        "dataStatus": "OBSERVED (signaux de détecteurs DERIVED)", "data": [args.data], "date": dt.datetime.now().isoformat(timespec="minutes"),
        "xgboost": xgb.__version__, "device": "cpu", "contractVersion": CONTRACT["version"], "params": PARAMS, "rounds": ROUNDS,
        "split": f"grouped by configuration, {OUTER} outer folds (>= 2 flashovers each), {INNER} inner folds for the thresholds",
        "rows": {"all": int(len(d["t"])), "asInstrumented": int(base.sum())}, "targetRecall": TARGET_RECALL,
        "thresholds": thr_final, "foldThresholds": fold_thr, "trees": {k: len(m.get_dump()) for k, m in final.items()},
        "secondaryThresholdsPerRun": thr_final_run,
        "thresholdRule": "rappel ≥ 0,95 par pas de temps, validation croisée imbriquée sur essais réels",
        "secondaryNote": "analyse secondaire, décidée après le premier résultat : seuil qui annonce au moins 95 % des locaux qui s'embrasent (et non 95 % des pas de temps)",
    }
    (out / "metrics.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.ship:
        # The shipped copy (team decision of 21/11, after the checkpoint): same trees and golden.csv, thresholds = the
        # secondary per-run ones, chosen after seeing the first result (post hoc), kept next to the prescribed ones.
        ship = Path(args.ship)
        for key in final:
            name = CONTRACT["models"][key]["file"]
            (ship / name).write_bytes((out / name).read_bytes())
        (ship / "golden.csv").write_bytes((out / "golden.csv").read_bytes())
        shipped = dict(meta, thresholds=thr_final_run, prescribedThresholds=thr_final,
                       thresholdRule="≥ 95 % des embrasements annoncés en validation croisée sur essais réels ; règle choisie après coup",
                       thresholdChoice="seuils secondaires par essai (annoncer au moins 95 % des locaux qui s'embrasent), choisis APRÈS le premier résultat ; "
                       "les seuils prescrits (rappel >= 0,95 par pas de temps) sont dans prescribedThresholds")
        (ship / "metrics.json").write_text(json.dumps(shipped, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"shipped to {ship} with thresholds {thr_final_run}")
    (rep_dir / "comparison.json").write_text(json.dumps({"folds": {c: outer[c] for c in configs}, "foldThresholds": fold_thr, "results": results}, indent=1, ensure_ascii=False, default=float) + "\n", encoding="utf-8")
    write_markdown(results, fold_thr, thr_final, rep_dir, configs, pos, outer, args.boot, thr_final_run)
    plot(d, models, idx_base, results, rep_dir)
    print(f"final v4: thresholds p30 {thr_final['p30']:.3f} p60 {thr_final['p60']:.3f}, secondary per run p30 {thr_final_run['p30']:.3f} p60 {thr_final_run['p60']:.3f} → {out}")


def fmt(v: float, pct: bool = False, dec: int = 2) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "—"
    return f"{100 * v:.0f} %" if pct else (f"{v:.0f}" if dec == 0 else f"{v:.{dec}f}")


def write_markdown(results: dict, fold_thr: list, thr_final: dict, rep_dir: Path, configs: list, pos: dict, outer: dict, boot: int, thr_final_run: dict) -> None:
    L = ["# v4 : modèle entraîné sur essais réels — comparaison", "",
         f"Généré par `ml/train_real.py`. Évaluation : validation croisée groupée par configuration, {OUTER} groupes externes (≥ 2 embrasements chacun), "
         f"seuils choisis par validation croisée imbriquée ({INNER} groupes internes) pour un rappel ≥ 0,95 par pas de temps. Seule la copie 0 de chaque essai "
         f"(l'essai tel qu'instrumenté) est évaluée. Intervalles à 95 % : bootstrap sur les configurations ({boot} tirages, appariés entre modèles). "
         "v1 et v3 : seuils livrés ; règle : seuil choisi sur la partie entraînement de chaque groupe. Mesures et étiquettes OBSERVED, signaux de détecteurs DERIVED.", "",
         "Pourquoi 4 groupes et pas 5 : les 11 embrasements tombent dans 6 configurations seulement (3, 3, 2, 1, 1, 1) ; 4 groupes est le maximum qui garde ≥ 2 embrasements par groupe de test.", "",
         "**Ligne « v4, seuil par essai (secondaire) » : analyse décidée APRÈS avoir vu le premier résultat.** Même modèle, même validation imbriquée, mais seuil choisi pour annoncer "
         "≥ 95 % des locaux qui s'embrasent (au moins une fois) au lieu de 95 % des pas de temps. À lire comme une piste, pas comme le résultat principal.", ""]
    for sname, res in results.items():
        if sname.startswith("_"):
            continue
        L += [f"## {sname}", "", "| Modèle | Embrasements annoncés | Avance médiane (s) | Avance P10 (s) | Fausses alertes (locaux calmes) | Rappel par pas | Précision par pas | PR-AUC | Brier |", "|---|---|---|---|---|---|---|---|---|"]
        for mname, r in res.items():
            if not isinstance(r, dict):
                continue
            p, c = r["point"], r["ci95"]
            ci = lambda k, pct=False, dec=2: f" [{fmt(c[k][0], pct, dec)} ; {fmt(c[k][1], pct, dec)}]" if not math.isnan(c[k][0]) else ""
            L.append(f"| {mname} | {p['detected']} / {p['flashovers']}{ci('detection', True)} | {fmt(p['medianLeadS'], dec=0)}{ci('medianLeadS', dec=0)} | "
                     f"{fmt(p['p10LeadS'], dec=0)}{ci('p10LeadS', dec=0)} | {p['falseAlarms']} / {p['quiet']} = {fmt(p['falseAlarmRate'], True)}{ci('falseAlarmRate', True)} | "
                     f"{fmt(p['recall'])}{ci('recall')} | {fmt(p['precision'])}{ci('precision')} | {fmt(p['prAuc'])}{ci('prAuc')} | {fmt(p['brier'], dec=3)}{ci('brier', dec=3)} |")
        L.append("")
        for k, v in res.items():
            if isinstance(v, list):
                L.append(f"- {k} (bootstrap apparié, IC 95 %) : [{100 * v[0]:+.0f} ; {100 * v[1]:+.0f}] points")
        L.append("")
    if "_oracle" in results:
        L += ["## Comparaison à détection égale (seuil oracle, pas un point de fonctionnement)", "",
              "Pour chaque modèle, le seuil le plus haut qui annonce encore les 11 embrasements, choisi sur les étiquettes du test : il compare la capacité "
              "des modèles à séparer les locaux, à règle égale, mais n'est pas utilisable tel quel.", "", "| Modèle | " + " | ".join(results["_oracle"]) + " |", "|---|" + "---|" * len(results["_oracle"])]
        for m in next(iter(results["_oracle"].values())):
            L.append(f"| {m} | " + " | ".join(f"{o[m]['falseAlarms']} / {o[m]['quiet']} fausses alertes" for o in results["_oracle"].values()) + " |")
        L.append("")
    L += ["## Groupes et seuils", "", "| Groupe | Configurations | Embrasements | Seuil v4 P30 | Seuil v4 P60 | Seuils v4 par essai P30 / P60 (secondaire) | Seuil règle |", "|---|---|---|---|---|---|---|"]
    for f in fold_thr:
        k = f["fold"]
        L.append(f"| {k} | {sum(1 for c in configs if outer[c] == k)} | {sum(pos[c] for c in configs if outer[c] == k)} | {f['v4']['p30']:.4f} | {f['v4']['p60']:.4f} | {f['v4PerRun']['p30']:.4f} / {f['v4PerRun']['p60']:.4f} | {f['rule']:.3f} |")
    L += ["", f"v4 finale (toutes les données réelles) : seuils = médiane des groupes, P30 {thr_final['p30']:.4f}, P60 {thr_final['p60']:.4f} ; "
          f"seuils secondaires par essai P30 {thr_final_run['p30']:.4f}, P60 {thr_final_run['p60']:.4f}.", ""]
    L += ["## Embrasements un par un (toutes données)", "", "| Essai | " + " | ".join(m for m in results["_rooms"]) + " |", "|---|" + "---|" * len(results["_rooms"])]
    first = next(iter(results["_rooms"].values()))
    for i, r in enumerate(first):
        cells = []
        for m, rooms in results["_rooms"].items():
            rr = rooms[i]
            cells.append(f"{rr['lead']:.0f} s" if rr["alerted"] and rr["lead"] is not None else "manqué")
        L.append(f"| {r['run'].split(':', 1)[1].split('~')[1]} | " + " | ".join(cells) + " |")
    (rep_dir / "comparison.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def plot(d: dict, models: dict, idx: np.ndarray, results: dict, rep_dir: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    colors = ["#188038", "#8ab4f8", "#d93025", "#e37400", "#5f6368"]
    y = d["y60"][idx]
    fig, ax = plt.subplots(figsize=(6, 4.4))
    for (mname, (s, a, _)), col in zip(models.items(), colors):
        o = np.argsort(-s[idx], kind="mergesort")
        tp = np.cumsum(y[o])
        ax.plot(tp / y.sum(), tp / np.arange(1, len(o) + 1), color=col, lw=2, label=f"{mname} (PR-AUC {average_precision(y, s[idx]):.2f})")
    ax.set(xlabel="Rappel", ylabel="Précision", title="Essais réels, embrasement ≤ 60 s (hors groupe)", xlim=(0, 1), ylim=(0, 1.02))
    ax.legend(fontsize=7.5)
    fig.tight_layout()
    fig.savefig(rep_dir / "pr_curves.png", dpi=130)
    plt.close(fig)

    res = results["toutes les données réelles"]
    names = [m for m in models]
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    for ax, key, title in ((axes[0], "detection", "Embrasements annoncés"), (axes[1], "falseAlarmRate", "Fausses alertes (locaux calmes)")):
        vals = [res[m]["point"][key] for m in names]
        lo = [res[m]["point"][key] - res[m]["ci95"][key][0] for m in names]
        hi = [res[m]["ci95"][key][1] - res[m]["point"][key] for m in names]
        ax.barh(range(len(names)), vals, xerr=[lo, hi], color=colors[: len(names)], capsize=4)
        ax.set_yticks(range(len(names)), [n.replace(" (réel seul)", "").replace(" (simulateur, livrée)", "").replace(" (simulateur, non livrée)", "").replace(" (pente + pannes)", "") for n in names])
        ax.set(xlim=(0, 1.05), title=title)
        ax.invert_yaxis()
    fig.suptitle("Essais réels, hors groupe · IC 95 % : bootstrap sur les configurations", fontsize=9)
    fig.tight_layout()
    fig.savefig(rep_dir / "detection_false_alarms.png", dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
