import csv
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Polygon, Circle, Rectangle

import propagation as p

# ========== A MODIFIER (télémétrie SIMULÉE du drone) ==========
CSV = "C:/Fire_project/video_test_detections.csv"
VIDEO = "C:/Fire_project/video_test.mp4"      # sert seulement à lire la taille de l'image
CLASSE = "fire"
DRONE_COL_LIGNE = (42, 18)   # position du drone sur la carte, en cases (colonne, ligne)
ALTITUDE_M = 60.0            # altitude au-dessus du sol (m)
CAP_DEG = 0.0                # direction vers laquelle pointe le HAUT de l'image (0 = nord, 90 = est)
CHAMP_H_DEG = 80.0           # angle de champ horizontal de la caméra (valeur de départ, drone non choisi)
ERR_GPS_M = 5.0              # erreur de position du drone (m), valeur de départ
ERR_CAP_DEG = 5.0            # erreur d'orientation (degrés), valeur de départ
ERR_ALT_REL = 0.10           # erreur relative d'altitude (10 %), valeur de départ
LARGEUR_PX, HAUTEUR_PX = 1920, 1080   # utilisés seulement si la vidéo est introuvable
# ==============================================================


def taille_image():
    try:
        import cv2
        cap = cv2.VideoCapture(VIDEO)
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        if w > 0 and h > 0:
            return w, h
    except Exception:
        pass
    return LARGEUR_PX, HAUTEUR_PX


W, H = taille_image()
DRONE_X = (DRONE_COL_LIGNE[0] + 0.5) * p.CELL
DRONE_Y = (DRONE_COL_LIGNE[1] + 0.5) * p.CELL
CAP = np.radians(CAP_DEG)


def metres_par_pixel():
    return 2.0 * ALTITUDE_M * np.tan(np.radians(CHAMP_H_DEG) / 2.0) / W


def pixel_vers_carte(u, v):
    """Caméra vers le bas, terrain plat : pixel (u, v) -> position (x, y) en mètres sur la carte (x = est, y = nord)."""
    mpp = metres_par_pixel()
    dx = (np.asarray(u, dtype=float) - W / 2.0) * mpp      # vers la droite de l'image
    dy = (H / 2.0 - np.asarray(v, dtype=float)) * mpp      # vers le haut de l'image
    est = dx * np.cos(CAP) + dy * np.sin(CAP)
    nord = -dx * np.sin(CAP) + dy * np.cos(CAP)
    return DRONE_X + est, DRONE_Y + nord


def carte_vers_pixel(x, y):
    mpp = metres_par_pixel()
    est, nord = x - DRONE_X, y - DRONE_Y
    dx = est * np.cos(CAP) - nord * np.sin(CAP)
    dy = est * np.sin(CAP) + nord * np.cos(CAP)
    return W / 2.0 + dx / mpp, H / 2.0 - dy / mpp


def incertitude(x, y):
    d = float(np.hypot(x - DRONE_X, y - DRONE_Y))
    return float(np.sqrt(ERR_GPS_M ** 2 + (d * np.radians(ERR_CAP_DEG)) ** 2 + (d * ERR_ALT_REL) ** 2))


def auto_test():
    x0, y0 = (p.IGNITION[0] + 1) * p.CELL, (p.IGNITION[1] + 1) * p.CELL
    u, v = carte_vers_pixel(x0, y0)
    x1, y1 = pixel_vers_carte(u, v)
    err = float(np.hypot(x1 - x0, y1 - y0))
    print(f"Auto-test géométrie (aller-retour carte -> pixel -> carte) : erreur {err:.9f} m "
          + ("OK" if err < 1e-6 else "ECHEC"))
    print(f"Image : {W} x {H} px | {metres_par_pixel():.3f} m/pixel | "
          f"zone vue au sol : {W * metres_par_pixel():.0f} m x {H * metres_par_pixel():.0f} m")
    cx, cy = pixel_vers_carte(W / 2.0, H / 2.0)
    print(f"Le centre de l'image tombe à ({float(cx):.0f} m, {float(cy):.0f} m) = la position du drone.")


def main():
    auto_test()
    centres, temps = [], []
    with open(CSV, newline="", encoding="utf-8") as f:
        for ligne in csv.DictReader(f):
            if ligne["classe"] != CLASSE:
                continue
            x1, y1, x2, y2 = (float(ligne[k]) for k in ("x1", "y1", "x2", "y2"))
            centres.append(((x1 + x2) / 2.0, (y1 + y2) / 2.0))
            temps.append(float(ligne["time_s"]))
    if not centres:
        print(f"Aucune détection de la classe '{CLASSE}' dans {CSV}.")
        return
    u = np.array([c[0] for c in centres])
    v = np.array([c[1] for c in centres])
    xs, ys = pixel_vers_carte(u, v)
    xm, ym = float(np.median(xs)), float(np.median(ys))
    dispersion = float(np.median(np.hypot(xs - xm, ys - ym)))
    inc = incertitude(xm, ym)
    col_f, lig_f = xm / p.CELL - 0.5, ym / p.CELL - 0.5
    dans = 0 <= col_f < p.N and 0 <= lig_f < p.N

    print(f"\nDétections '{CLASSE}' : {len(centres)} (première à {min(temps):.1f} s)")
    print(f"Position estimée du feu : x = {xm:.0f} m, y = {ym:.0f} m "
          f"-> case (colonne {col_f:.1f}, ligne {lig_f:.1f})")
    print(f"Incertitude de position (valeurs de départ non calibrées) : environ {inc:.0f} m")
    print(f"Dispersion des détections entre images : environ {dispersion:.1f} m")
    if not dans:
        print("ATTENTION : cette position est hors de la carte.")
    else:
        c0 = int(round(min(max(xm / p.CELL - 1.0, 0), p.N - 2)))
        r0 = int(round(min(max(ym / p.CELL - 1.0, 0), p.N - 2)))
        classe = int(p.GRID[r0, c0])
        print(f"Valeur correspondante pour IGNITION dans propagation.py : ({c0}, {r0})  "
              f"[classe de la case : {classe}]")
        if classe not in (2, 3, 4, 5, 6):
            print("ATTENTION : cette case n'est pas combustible (sol nu ou route).")

    fig, ax = plt.subplots(figsize=(8, 8))
    ext = (0, p.N * p.CELL, 0, p.N * p.CELL)
    ax.imshow(p.GRID, cmap=ListedColormap(p.COULEURS), vmin=0, vmax=6, origin="lower",
              extent=ext, interpolation="nearest", alpha=0.7)
    for nb, (a, b, c, d) in p.BATIMENTS.items():
        ax.add_patch(Rectangle((a * p.CELL, b * p.CELL), (c - a) * p.CELL, (d - b) * p.CELL,
                               fill=False, edgecolor="black", linewidth=1.2))
        ax.text((a + c) / 2 * p.CELL, (b + d) / 2 * p.CELL, nb[0], ha="center", va="center",
                fontsize=12, fontweight="bold")
    coins = [pixel_vers_carte(a, b) for a, b in ((0, 0), (W, 0), (W, H), (0, H))]
    ax.add_patch(Polygon([(float(a), float(b)) for a, b in coins], closed=True, fill=False,
                         edgecolor="blue", linewidth=2, linestyle="--", label="zone vue par la caméra"))
    ax.plot(DRONE_X, DRONE_Y, marker="o", color="blue", markersize=8, linestyle="", label="drone (simulé)")
    pas = max(1, len(xs) // 500)
    ax.scatter(xs[::pas], ys[::pas], s=8, c="red", alpha=0.4, label="détections de feu")
    ax.plot(xm, ym, marker="*", color="yellow", markeredgecolor="black", markersize=18,
            linestyle="", label="feu estimé")
    ax.add_patch(Circle((xm, ym), inc, fill=False, edgecolor="orange", linewidth=2,
                        label=f"incertitude ~{inc:.0f} m"))
    ax.set_xlim(0, p.N * p.CELL)
    ax.set_ylim(0, p.N * p.CELL)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.legend(loc="upper left", fontsize=8, framealpha=0.9)
    ax.set_title("Localisation du feu sur la carte - télémétrie simulée, caméra vers le bas, terrain plat",
                 fontsize=10)
    fig.savefig(f"{p.SORTIE}/localisation_feu.png", dpi=110, bbox_inches="tight")
    plt.close(fig)

    with open(f"{p.SORTIE}/localisation_feu.json", "w", encoding="utf-8") as f:
        json.dump(dict(x_m=xm, y_m=ym, colonne=col_f, ligne=lig_f, incertitude_m=inc,
                       dispersion_m=dispersion, nb_detections=len(centres),
                       drone=dict(colonne=DRONE_COL_LIGNE[0], ligne=DRONE_COL_LIGNE[1],
                                  altitude_m=ALTITUDE_M, cap_deg=CAP_DEG, champ_h_deg=CHAMP_H_DEG)),
                  f, ensure_ascii=False, indent=2)
    print(f"\nImage et données enregistrées dans : {p.SORTIE}")


if __name__ == "__main__":
    main()
