import os
import time
from collections import deque
import cv2
from ultralytics import YOLO

# ========== A MODIFIER ==========
VIDEO = "C:/Fire_project/video_test.mp4"   # ta vidéo
CONF_FEU = 0.15      # seuil pour le feu (plus bas = plus sensible)
CONF_FUMEE = 0.25    # seuil pour la fumée
FENETRE = 8          # on regarde les 8 dernières images
MIN_DETECTIONS = 4   # alerte si détecté sur au moins 4 de ces 8 images
# =================================

MODEL = "C:/Fire_project/runs/dfire_v1/weights/best.pt"
SEUILS = {"fire": CONF_FEU, "smoke": CONF_FUMEE}
NOMS = {"fire": "FEU", "smoke": "FUMEE"}
COULEURS = {"fire": (0, 0, 255), "smoke": (200, 200, 200)}


def main():
    base, _ = os.path.splitext(VIDEO)
    sortie = base + "_alerte.mp4"

    model = YOLO(MODEL)
    cap = cv2.VideoCapture(VIDEO)
    if not cap.isOpened():
        raise SystemExit("Impossible d'ouvrir la vidéo : vérifie la ligne VIDEO en haut du fichier.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(sortie, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    hist = {c: deque(maxlen=FENETRE) for c in SEUILS}
    etat = {c: False for c in SEUILS}
    stats = {c: {"brut": 0, "alerte": 0, "premiere": None, "episodes": 0} for c in SEUILS}
    conf_min = min(SEUILS.values())
    idx = 0
    t0 = time.time()
    print(f"Analyse de {VIDEO} ({total} images)...", flush=True)

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        r = model.predict(frame, conf=conf_min, verbose=False, device=0)[0]
        vus = set()
        for (x1, y1, x2, y2), cls, conf in zip(r.boxes.xyxy.tolist(),
                                              r.boxes.cls.tolist(),
                                              r.boxes.conf.tolist()):
            nom = model.names[int(cls)]
            if nom not in SEUILS or conf < SEUILS[nom]:
                continue
            vus.add(nom)
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), COULEURS[nom], 3)
            cv2.putText(frame, f"{NOMS[nom]} {conf:.2f}", (int(x1), max(int(y1) - 8, 20)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, COULEURS[nom], 2)

        for c in SEUILS:
            hist[c].append(c in vus)
            if c in vus:
                stats[c]["brut"] += 1
            nb = sum(hist[c])
            if not etat[c] and nb >= MIN_DETECTIONS:
                etat[c] = True
                stats[c]["episodes"] += 1
                if stats[c]["premiere"] is None:
                    stats[c]["premiere"] = idx / fps
            elif etat[c] and nb == 0:
                etat[c] = False
            if etat[c]:
                stats[c]["alerte"] += 1

        actifs = [NOMS[c] for c in SEUILS if etat[c]]
        if actifs:
            cv2.rectangle(frame, (0, 0), (w, 60), (0, 0, 200), -1)
            cv2.putText(frame, "ALERTE : " + " + ".join(actifs), (15, 42),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.3, (255, 255, 255), 3)

        writer.write(frame)
        idx += 1
        if idx % 100 == 0:
            print(f"{idx}/{total} images ({idx / (time.time() - t0):.1f} img/s)", flush=True)

    cap.release()
    writer.release()

    print("\n========== RESUME ==========")
    print(f"Images analysées : {idx} ({idx / fps:.1f} s)")
    print(f"Réglages : feu {CONF_FEU} | fumée {CONF_FUMEE} | fenêtre {FENETRE} | min {MIN_DETECTIONS}")
    for c in SEUILS:
        s = stats[c]
        if s["premiere"] is None:
            premiere = "AUCUNE ALERTE"
        else:
            premiere = f"à {s['premiere']:.1f} s"
        print(f"[{NOMS[c]}] détections brutes : {s['brut']} images | "
              f"en alerte : {s['alerte']} images | épisodes d'alerte : {s['episodes']} | "
              f"première alerte : {premiere}")
    print(f"Vidéo annotée : {sortie}")


if __name__ == "__main__":
    main()
