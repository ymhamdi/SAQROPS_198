import os
import random
import glob
from ultralytics import YOLO

# ========== A MODIFIER SI BESOIN ==========
IMAGES = "C:/Fire_project/DFire/test/images"
LABELS = "C:/Fire_project/DFire/test/labels"
MODEL = "C:/Fire_project/runs/dfire_v1/weights/best.pt"
MAX_IMAGES = 1000                      # nombre d'images testées
SEUILS = [0.10, 0.15, 0.25, 0.40]      # seuils à comparer
# ==========================================


def est_sans_objet(image_path):
    stem = os.path.splitext(os.path.basename(image_path))[0]
    lbl = f"{LABELS}/{stem}.txt"
    if not os.path.exists(lbl):
        return True
    with open(lbl) as f:
        return f.read().strip() == ""


def main():
    toutes = []
    for ext in ("*.jpg", "*.jpeg", "*.png"):
        toutes += glob.glob(f"{IMAGES}/{ext}")
    sans = [p for p in toutes if est_sans_objet(p)]
    print(f"Images sans feu ni fumée trouvées : {len(sans)}", flush=True)
    if not sans:
        raise SystemExit("Aucune image trouvée : vérifie les chemins IMAGES et LABELS.")

    random.seed(0)
    random.shuffle(sans)
    sans = sans[:MAX_IMAGES]
    print(f"Test sur {len(sans)} images...", flush=True)

    model = YOLO(MODEL)
    id_feu = next(k for k, v in model.names.items() if v == "fire")
    id_fumee = next(k for k, v in model.names.items() if v == "smoke")

    resultats = []   # (chemin, conf max feu, conf max fumée)
    for i, chemin in enumerate(sans, 1):
        r = model.predict(source=chemin, conf=min(SEUILS), imgsz=640,
                          verbose=False, device=0)[0]
        cmax = {id_feu: 0.0, id_fumee: 0.0}
        for cls, conf in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()):
            cmax[int(cls)] = max(cmax[int(cls)], conf)
        resultats.append((chemin, cmax[id_feu], cmax[id_fumee]))
        if i % 200 == 0:
            print(f"{i}/{len(sans)} images traitées", flush=True)

    n = len(resultats)
    print("\n===== FAUSSES ALERTES (par image, sans lissage) =====")
    print("Seuil | feu à tort | fumée à tort | au moins une")
    for s in SEUILS:
        f = sum(1 for _, cf, _ in resultats if cf >= s)
        m = sum(1 for _, _, cm in resultats if cm >= s)
        a = sum(1 for _, cf, cm in resultats if cf >= s or cm >= s)
        print(f"{s:.2f}  | {f / n * 100:5.1f} %    | {m / n * 100:5.1f} %      | {a / n * 100:5.1f} %")

    pires = sorted(resultats, key=lambda x: max(x[1], x[2]), reverse=True)[:12]
    pires = [p for p in pires if max(p[1], p[2]) >= min(SEUILS)]
    if pires:
        for p in pires:
            model.predict(source=p[0], conf=min(SEUILS), imgsz=640, save=True,
                          project="C:/Fire_project/fausses_alertes", name="pires",
                          exist_ok=True, verbose=False, device=0)
        print("\nLes pires cas sont enregistrés dans : C:/Fire_project/fausses_alertes/pires")
    else:
        print("\nAucune fausse alerte, même au seuil le plus bas.")


if __name__ == "__main__":
    main()
