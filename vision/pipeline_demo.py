import json
import time
from collections import deque

import cv2
import numpy as np
from ultralytics import YOLO

import propagation as p
import localisation as loc
import generer_page as gp

# ========== A MODIFIER ==========
MODELE = "C:/Fire_project/runs/dfire_v1/weights/best.pt"
SEUIL_FEU = 0.15            # seuil retenu pour le feu
FENETRE, MIN_DETECT = 8, 4  # alerte : détection sur 4 images parmi les 8 dernières
# ================================
VIDEO = loc.VIDEO           # même vidéo et même télémétrie simulée que localisation.py


def detecter_feu(video):
    model = YOLO(MODELE)
    feu_id = [i for i, n in model.names.items() if n == "fire"][0]
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit("Impossible d'ouvrir la vidéo : " + video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    recent = deque(maxlen=FENETRE)
    centres, premiere, idx = [], None, 0
    t0 = time.time()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        r = model.predict(frame, conf=SEUIL_FEU, imgsz=640, verbose=False, device=0)[0]
        meilleur = None
        for box, cls, conf in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
            if int(cls) == feu_id and (meilleur is None or conf > meilleur[0]):
                meilleur = (conf, box)
        recent.append(meilleur is not None)
        alerte = sum(recent) >= MIN_DETECT
        if alerte and premiere is None:
            premiere = idx / fps
        if alerte and meilleur is not None:
            x1, y1, x2, y2 = meilleur[1]
            centres.append(((x1 + x2) / 2.0, (y1 + y2) / 2.0))
        idx += 1
    cap.release()
    print(f"YOLO : {idx} images analysées en {time.time() - t0:.0f} s")
    return centres, premiere, idx


def main():
    centres, premiere, nb_images = detecter_feu(VIDEO)
    if not centres:
        print("Aucune alerte feu dans cette vidéo : pas de simulation lancée.")
        return
    u = np.array([c[0] for c in centres])
    v = np.array([c[1] for c in centres])
    xs, ys = loc.pixel_vers_carte(u, v)
    xm, ym = float(np.median(xs)), float(np.median(ys))
    inc = loc.incertitude(xm, ym)

    c0 = int(round(min(max(xm / p.CELL - 1.0, 0), p.N - 2)))
    r0 = int(round(min(max(ym / p.CELL - 1.0, 0), p.N - 2)))
    if int(p.GRID[r0, c0]) not in (2, 3, 4, 5, 6):
        ys_, xs_ = np.nonzero(np.isin(p.GRID, (2, 3, 4, 5, 6)))
        k = int(np.argmin((xs_ - c0) ** 2 + (ys_ - r0) ** 2))
        c0, r0 = min(int(xs_[k]), p.N - 2), min(int(ys_[k]), p.N - 2)
        print("La case détectée n'est pas combustible : départ de feu déplacé à la case combustible la plus proche.")
    p.IGNITION = (c0, r0)

    print(f"\nAlerte feu à {premiere:.1f} s ({len(centres)} détections retenues après lissage)")
    print(f"Position estimée : x = {xm:.0f} m, y = {ym:.0f} m, incertitude environ {inc:.0f} m")
    print(f"Départ de feu utilisé dans la simulation : case ({c0}, {r0})")

    gp.FICHIER = f"{p.SORTIE}/page_demo_yolo.html"
    gp.main()

    info = (f"Départ de feu issu de la détection par le modèle YOLO : première alerte à {premiere:.1f} s, "
            f"{len(centres)} détections retenues, position estimée ({xm:.0f} m, {ym:.0f} m), "
            f"incertitude environ {inc:.0f} m. Télémétrie du drone simulée.")
    with open(gp.FICHIER, encoding="utf-8") as f:
        html = f.read()
    html = html.replace("</p></header>", "</p><p>" + info + "</p></header>", 1)
    with open(gp.FICHIER, "w", encoding="utf-8") as f:
        f.write(html)

    with open(f"{p.SORTIE}/pipeline_yolo.json", "w", encoding="utf-8") as f:
        json.dump(dict(video=VIDEO, premiere_alerte_s=premiere, detections=len(centres),
                       x_m=xm, y_m=ym, incertitude_m=inc, ignition=[c0, r0]),
                  f, ensure_ascii=False, indent=2)
    print("\nOuvre la page avec : start " + gp.FICHIER.replace("/", "\\"))


if __name__ == "__main__":
    main()
