import os
import csv
import glob
import json
import time
import random
import platform
import cv2
import numpy as np
import torch
import ultralytics
from ultralytics import YOLO

# ========== A MODIFIER SI BESOIN ==========
MODEL = "C:/Fire_project/runs/dfire_v1/weights/best.pt"
RUN_DIR = "C:/Fire_project/runs/dfire_v1"
DATA = "C:/Fire_project/data.yaml"
DFIRE = "C:/Fire_project/DFire"
SORTIE = "C:/Fire_project/resultats_finaux"
SEUIL_FEU = 0.15
SEUIL_FUMEE = 0.25
SEUILS_TABLEAU = [0.10, 0.15, 0.25, 0.40, 0.50]
N_FONDS = 1000
N_BENCH = 200
N_BENCH_CPU = 30
# ==========================================

lignes = []


def ecrire(txt=""):
    print(txt, flush=True)
    lignes.append(txt)


def lister_split(split):
    imgs = []
    for ext in ("*.jpg", "*.jpeg", "*.png"):
        imgs += glob.glob(f"{DFIRE}/{split}/images/{ext}")
    fonds, inst = [], {}
    for p in imgs:
        stem = os.path.splitext(os.path.basename(p))[0]
        lbl = f"{DFIRE}/{split}/labels/{stem}.txt"
        txt = open(lbl).read().strip() if os.path.exists(lbl) else ""
        if not txt:
            fonds.append(p)
            continue
        for ligne in txt.splitlines():
            c = int(ligne.split()[0])
            inst[c] = inst.get(c, 0) + 1
    return imgs, fonds, inst


def bench(model, frames, gpu, half, n_warm):
    dev = 0 if gpu else "cpu"
    for f in frames[:n_warm]:
        model.predict(f, imgsz=640, device=dev, half=half, verbose=False)
    if gpu:
        torch.cuda.synchronize()
    tot, pre, inf, post = [], [], [], []
    for f in frames:
        t0 = time.perf_counter()
        r = model.predict(f, imgsz=640, device=dev, half=half, conf=0.15, verbose=False)[0]
        if gpu:
            torch.cuda.synchronize()
        tot.append((time.perf_counter() - t0) * 1000)
        pre.append(r.speed["preprocess"])
        inf.append(r.speed["inference"])
        post.append(r.speed["postprocess"])
    moy = float(np.mean(tot))
    return {
        "ms_moyen": moy,
        "ms_median": float(np.median(tot)),
        "ms_p95": float(np.percentile(tot, 95)),
        "fps": 1000.0 / moy,
        "ms_prétraitement": float(np.mean(pre)),
        "ms_inférence": float(np.mean(inf)),
        "ms_postraitement": float(np.mean(post)),
    }


def main():
    os.makedirs(SORTIE, exist_ok=True)
    res = {}
    model = YOLO(MODEL)
    noms = model.names
    id_de = {v: k for k, v in noms.items()}

    # ---------- 1. Environnement et modèle ----------
    ecrire("# RAPPORT D'EVALUATION FINALE")
    ecrire(f"Date : {time.strftime('%Y-%m-%d %H:%M')}")
    ecrire("\n## 1. Environnement et modèle")
    params = sum(p.numel() for p in model.model.parameters())
    taille = os.path.getsize(MODEL) / 1e6
    gflops = None
    try:
        info = model.info(verbose=False)
        gflops = float(info[3])
    except Exception:
        pass
    ecrire(f"- Matériel : {torch.cuda.get_device_name(0)} | {platform.processor()}")
    ecrire(f"- Logiciels : Python {platform.python_version()} | PyTorch {torch.__version__} "
           f"| Ultralytics {ultralytics.__version__}")
    ecrire(f"- Modèle : YOLOv8s (base pré-entraînée, affinée sur D-Fire) | classes : {list(noms.values())}")
    ecrire(f"- Paramètres : {params / 1e6:.2f} M | taille du fichier : {taille:.1f} Mo"
           + (f" | complexité : {gflops:.1f} GFLOPs" if gflops else ""))
    try:
        with open(f"{RUN_DIR}/results.csv", newline="") as f:
            lignes_csv = list(csv.DictReader(f))
        ecrire(f"- Entraînement : {len(lignes_csv)} époques effectuées (voir results.csv)")
        res["epoques"] = len(lignes_csv)
    except Exception:
        ecrire("- Entraînement : results.csv introuvable")
    res.update(params_millions=params / 1e6, taille_mo=taille, gflops=gflops)

    # ---------- 2. Données ----------
    ecrire("\n## 2. Données (D-Fire)")
    for split in ("train", "test"):
        imgs, fonds, inst = lister_split(split)
        det = " | ".join(f"{noms[k]} : {v}" for k, v in sorted(inst.items()))
        ecrire(f"- {split} : {len(imgs)} images dont {len(fonds)} sans feu ni fumée | boîtes annotées : {det}")
        if split == "test":
            fonds_test = fonds
            imgs_test = imgs

    # ---------- 3. Métriques de détection ----------
    ecrire("\n## 3. Métriques de détection (jeu de test D-Fire)")
    m = model.val(data=DATA, imgsz=640, batch=8, device=0, workers=2, plots=True,
                  project=SORTIE, name="val", exist_ok=True, verbose=False)
    ecrire("Mesures standard (seuil optimisant le F1) :")
    ecrire(f"- GLOBAL : précision {m.box.mp:.3f} | rappel {m.box.mr:.3f} | "
           f"mAP50 {m.box.map50:.3f} | mAP50-95 {m.box.map:.3f}")
    idx = [int(k) for k in m.box.ap_class_index]
    for j, k in enumerate(idx):
        ecrire(f"- {noms[k].upper()} : précision {m.box.p[j]:.3f} | rappel {m.box.r[j]:.3f} | "
               f"mAP50 {m.box.ap50[j]:.3f} | mAP50-95 {m.box.ap[j]:.3f}")
    res["global"] = dict(precision=float(m.box.mp), rappel=float(m.box.mr),
                         map50=float(m.box.map50), map50_95=float(m.box.map))

    px = np.array(m.box.px)
    ecrire("\nPrécision / rappel / F1 selon le seuil de confiance :")
    ecrire("| Seuil | " + " | ".join(f"{noms[k]} (P / R / F1)" for k in idx) + " |")
    ecrire("|---|" + "---|" * len(idx))
    for s in SEUILS_TABLEAU:
        i = int(np.argmin(np.abs(px - s)))
        cols = []
        for j, k in enumerate(idx):
            p, r = float(m.box.p_curve[j][i]), float(m.box.r_curve[j][i])
            cols.append(f"{p:.2f} / {r:.2f} / {2 * p * r / (p + r + 1e-9):.2f}")
        ecrire(f"| {s:.2f} | " + " | ".join(cols) + " |")

    ecrire(f"\nPOINT DE FONCTIONNEMENT RETENU : feu {SEUIL_FEU} | fumée {SEUIL_FUMEE}")
    pf = {}
    for nom, s in (("fire", SEUIL_FEU), ("smoke", SEUIL_FUMEE)):
        j = idx.index(id_de[nom])
        i = int(np.argmin(np.abs(px - s)))
        p, r = float(m.box.p_curve[j][i]), float(m.box.r_curve[j][i])
        pf[nom] = (p, r)
        ecrire(f"- {nom} à {s} : précision {p:.2f} | rappel {r:.2f} | F1 {2 * p * r / (p + r + 1e-9):.2f}")
    res["point_fonctionnement"] = {k: dict(precision=v[0], rappel=v[1]) for k, v in pf.items()}

    # ---------- 4. Fausses alertes ----------
    ecrire("\n## 4. Fausses alertes sur images sans feu ni fumée (par image, sans lissage)")
    random.seed(0)
    fonds = random.sample(fonds_test, min(N_FONDS, len(fonds_test)))
    cmax = []
    for i, chemin in enumerate(fonds, 1):
        r = model.predict(source=chemin, conf=0.10, imgsz=640, verbose=False, device=0)[0]
        c = {id_de["fire"]: 0.0, id_de["smoke"]: 0.0}
        for cls, conf in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()):
            c[int(cls)] = max(c[int(cls)], conf)
        cmax.append((c[id_de["fire"]], c[id_de["smoke"]]))
        if i % 250 == 0:
            print(f"  fausses alertes : {i}/{len(fonds)}", flush=True)
    n = len(cmax)
    ecrire(f"Échantillon : {n} images sans feu ni fumée tirées au hasard dans le jeu de test.")
    ecrire("| Seuil | feu à tort | fumée à tort | au moins une |")
    ecrire("|---|---|---|---|")
    for s in (0.10, 0.15, 0.25, 0.40):
        f = sum(1 for a, _ in cmax if a >= s) / n * 100
        u = sum(1 for _, b in cmax if b >= s) / n * 100
        t = sum(1 for a, b in cmax if a >= s or b >= s) / n * 100
        ecrire(f"| {s:.2f} | {f:.1f} % | {u:.1f} % | {t:.1f} % |")
    fa = sum(1 for a, b in cmax if a >= SEUIL_FEU or b >= SEUIL_FUMEE) / n * 100
    ecrire(f"Au point de fonctionnement retenu : {fa:.1f} % des images sans feu déclenchent une détection.")
    res["fausses_alertes_point_fonctionnement_pct"] = fa

    # ---------- 5. Vitesse ----------
    ecrire("\n## 5. Vitesse (image par image, 640 px, prétraitement + inférence + post-traitement)")
    random.seed(1)
    echant = random.sample(imgs_test, N_BENCH)
    frames = [cv2.imread(p) for p in echant]
    frames = [f for f in frames if f is not None]
    b_gpu = bench(model, frames, True, False, 20)
    b_half = bench(model, frames, True, True, 20)
    b_cpu = bench(model, frames[:N_BENCH_CPU], False, False, 3)
    ecrire("| Mode | ms/image (moyenne) | médiane | p95 | images/s |")
    ecrire("|---|---|---|---|---|")
    for nom, b in (("GPU RTX 4050 (FP32)", b_gpu), ("GPU RTX 4050 (FP16)", b_half), ("CPU", b_cpu)):
        ecrire(f"| {nom} | {b['ms_moyen']:.1f} | {b['ms_median']:.1f} | {b['ms_p95']:.1f} | {b['fps']:.1f} |")
    ecrire(f"Détail GPU FP32 : prétraitement {b_gpu['ms_prétraitement']:.1f} ms | "
           f"inférence {b_gpu['ms_inférence']:.1f} ms | post-traitement {b_gpu['ms_postraitement']:.1f} ms")
    res["vitesse"] = dict(gpu_fp32=b_gpu, gpu_fp16=b_half, cpu=b_cpu)

    # ---------- Sauvegarde ----------
    with open(f"{SORTIE}/rapport.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(lignes))
    with open(f"{SORTIE}/resultats.json", "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
    print(f"\nRapport : {SORTIE}/rapport.txt")
    print(f"Données : {SORTIE}/resultats.json")
    print(f"Graphiques (matrice de confusion, courbes P/R/F1) : {SORTIE}/val")


if __name__ == "__main__":
    main()
