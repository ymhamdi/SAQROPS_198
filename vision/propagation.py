import json
import time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Rectangle

SITE = "C:/Fire_project/carte/site_demo.json"
SORTIE = "C:/Fire_project/carte"

# ========== A MODIFIER ==========
IGNITION = (40, 15)            # (colonne, ligne) du départ de feu
NB_SIMULATIONS = 100
HORIZONS = [10, 20, 30, 45]    # minutes après le départ de feu
SCENARIOS = [
    # (nom de fichier, titre, vitesse du vent en km/h, direction D'OU VIENT le vent en degrés)
    ("vent_faible", "Vent faible 10 km/h", 10, 200),
    ("sirocco", "Sirocco 40 km/h", 40, 200),
]
# ================================

DT = 0.1   # minutes par pas de simulation
# Classes : 0 sol nu, 1 route, 2 bâtiment, 3 stock inflammable, 4 herbe, 5 broussailles, 6 arbres
ROS = np.array([0.0, 0.0, 1.5, 10.0, 25.0, 12.0, 6.0])    # vitesse de base sans vent (m/min)
DUREE = np.array([0, 0, 45, 60, 3, 8, 15])                  # durée de combustion (min)
P_ALLUME_BRANDON = np.array([0.0, 0.0, 0.10, 0.5, 0.5, 0.4, 0.3])
C1, C2 = 0.045, 0.131     # effet du vent sur la propagation
P_BRANDON = 0.0002        # brandons par pas, par case en feu, par m/s de vent
DIST_BRANDON = 8.0        # distance moyenne des brandons (m) par m/s de vent
COULEURS = ["#d9d9d9", "#7f7f7f", "#4a6fa5", "#e07b39", "#d8d36b", "#8f9b3a", "#2f7d32"]
BATIMENTS = {
    "A Hall de production": (35, 58, 58, 90),
    "B Entrepôt": (66, 58, 92, 90),
    "C Bureaux": (35, 30, 57, 50),
    "D Stockage inflammable": (66, 30, 88, 48),
}

with open(SITE, encoding="utf-8") as f:
    site = json.load(f)
GRID = np.array(site["grid"], dtype=int)
N = int(site["n"])
CELL = float(site["cell_m"])
DIRS = [(dc, dr) for dc in (-1, 0, 1) for dr in (-1, 0, 1) if (dc, dr) != (0, 0)]


def decaler(a, dc, dr):
    """b[r, c] = a[r - dr, c - dc] : la valeur du voisin qui propage vers cette case."""
    b = np.zeros_like(a)
    cs = slice(max(dc, 0), N + min(dc, 0))
    cx = slice(max(-dc, 0), N + min(-dc, 0))
    rs = slice(max(dr, 0), N + min(dr, 0))
    rx = slice(max(-dr, 0), N + min(-dr, 0))
    b[rs, cs] = a[rx, cx]
    return b


def cartes_propagation(v, wx, wy):
    """Probabilité par pas qu'un voisin en feu enflamme la case, pour chacune des 8 directions."""
    ros_map = ROS[GRID]
    cartes = []
    for dc, dr in DIRS:
        norme = np.hypot(dc, dr)
        cos_t = (dc * wx + dr * wy) / norme
        pw = np.exp(C1 * v) * np.exp(C2 * v * (cos_t - 1.0))
        cartes.append(np.clip(ros_map * pw * DT / (CELL * norme), 0.0, 1.0))
    return cartes


def une_simulation(rng, cartes, v, wx, wy, nsteps):
    etat = np.zeros((N, N), dtype=np.int8)       # 0 intact, 1 en feu, 2 brûlé
    reste = np.zeros((N, N), dtype=np.int32)
    arrivee = np.full((N, N), np.inf)
    duree_pas = np.maximum(1, np.rint(DUREE[GRID] / DT)).astype(np.int32)
    c0, r0 = IGNITION
    for dr in (0, 1):
        for dc in (0, 1):
            etat[r0 + dr, c0 + dc] = 1
            reste[r0 + dr, c0 + dc] = duree_pas[r0 + dr, c0 + dc]
            arrivee[r0 + dr, c0 + dc] = 0.0

    for pas in range(nsteps):
        brule = etat == 1
        if not brule.any():
            break
        brule_f = brule.astype(float)
        pas_allume = np.ones((N, N))
        for (dc, dr), pm in zip(DIRS, cartes):
            pas_allume *= 1.0 - decaler(brule_f, dc, dr) * pm
        nouveau = (etat == 0) & (rng.random((N, N)) < (1.0 - pas_allume))

        if v > 0:
            lignes, colonnes = np.nonzero(brule)
            tirage = rng.random(lignes.size) < P_BRANDON * v
            if tirage.any():
                lg, cl = lignes[tirage], colonnes[tirage]
                d = rng.exponential(DIST_BRANDON * v, lg.size) / CELL
                lat = rng.normal(0.0, 0.3, lg.size) * d
                c1 = np.rint(cl + d * wx - lat * wy).astype(int)
                r1 = np.rint(lg + d * wy + lat * wx).astype(int)
                ok = (c1 >= 0) & (c1 < N) & (r1 >= 0) & (r1 < N)
                c1, r1 = c1[ok], r1[ok]
                reussi = (etat[r1, c1] == 0) & (rng.random(c1.size) < P_ALLUME_BRANDON[GRID[r1, c1]])
                nouveau[r1[reussi], c1[reussi]] = True

        reste[brule] -= 1
        fini = brule & (reste <= 0)
        etat[fini] = 2
        etat[nouveau] = 1
        reste[nouveau] = duree_pas[nouveau]
        arrivee[nouveau] = (pas + 1) * DT
    return arrivee


def tableau(arrivees, titre):
    print(f"\n=== {titre} ===")
    print("Surface brûlée moyenne : " + " | ".join(
        f"+{h} min : {(arrivees <= h).sum(axis=(1, 2)).mean() * CELL * CELL / 10000:.1f} ha" for h in HORIZONS))
    print("Probabilité qu'au moins une case du bâtiment brûle :")
    print("Bâtiment".ljust(24) + "".join(f"+{h} min".rjust(9) for h in HORIZONS) + "   arrivée médiane")
    premieres = []
    for nom, (a, b, c, d) in BATIMENTS.items():
        prem = arrivees[:, b:d, a:c].reshape(len(arrivees), -1).min(axis=1)
        premieres.append(prem)
        probas = "".join(f"{(prem <= h).mean() * 100:8.0f}%" for h in HORIZONS)
        atteints = prem[np.isfinite(prem)]
        med = f"{np.median(atteints):.0f} min" if atteints.size else "jamais touché"
        print(nom.ljust(24) + probas + "   " + med)
    tous = np.min(np.stack(premieres), axis=0)
    print("Au moins un bâtiment".ljust(24) + "".join(f"{(tous <= h).mean() * 100:8.0f}%" for h in HORIZONS))


def dessiner(arrivees, nom, titre, kmh, d_vent, wx, wy):
    fig, axes = plt.subplots(1, len(HORIZONS), figsize=(4.6 * len(HORIZONS), 5.2))
    etendue = (0, N * CELL, 0, N * CELL)
    im = None
    for ax, h in zip(axes, HORIZONS):
        p = (arrivees <= h).mean(axis=0)
        ax.imshow(GRID, cmap=ListedColormap(COULEURS), vmin=0, vmax=6, origin="lower",
                  extent=etendue, interpolation="nearest", alpha=0.55)
        im = ax.imshow(np.ma.masked_less(p, 0.02), cmap="Reds", vmin=0, vmax=1, origin="lower",
                       extent=etendue, interpolation="nearest", alpha=0.9)
        for nb, (a, b, c, d) in BATIMENTS.items():
            ax.add_patch(Rectangle((a * CELL, b * CELL), (c - a) * CELL, (d - b) * CELL,
                                   fill=False, edgecolor="black", linewidth=1.2))
            ax.text((a + c) / 2 * CELL, (b + d) / 2 * CELL, nb[0], ha="center", va="center",
                    fontsize=12, fontweight="bold")
        ax.plot((IGNITION[0] + 1) * CELL, (IGNITION[1] + 1) * CELL, marker="*", color="yellow",
                markeredgecolor="black", markersize=15, linestyle="")
        ax.annotate("", xy=(520 + wx * 60, 80 + wy * 60), xytext=(520, 80),
                    arrowprops=dict(arrowstyle="->", lw=3, color="blue"))
        ax.text(520, 25, "vent", color="blue", ha="center", fontsize=9)
        ax.set_title(f"+{h} min")
        ax.set_xticks([])
        ax.set_yticks([])
    fig.colorbar(im, ax=list(axes), shrink=0.8, label="Probabilité que la case ait brûlé")
    fig.suptitle(f"{titre} (vent venant de {d_vent}°) - {len(arrivees)} simulations - étoile = départ du feu",
                 fontsize=12)
    fig.savefig(f"{SORTIE}/propagation_{nom}.png", dpi=110, bbox_inches="tight")
    plt.close(fig)


def main():
    c0, r0 = IGNITION
    if GRID[r0, c0] not in (2, 3, 4, 5, 6):
        print(f"ATTENTION : le départ de feu {IGNITION} est sur une case non combustible.")
    nsteps = int(round(max(HORIZONS) / DT))
    for nom, titre, kmh, d_vent in SCENARIOS:
        v = kmh / 3.6
        vers = np.radians((d_vent + 180) % 360)     # direction vers laquelle souffle le vent
        wx, wy = np.sin(vers), np.cos(vers)
        cartes = cartes_propagation(v, wx, wy)
        rng = np.random.default_rng(42)
        print(f"\nScénario : {titre} ({NB_SIMULATIONS} simulations)...", flush=True)
        t0 = time.time()
        res = []
        for i in range(NB_SIMULATIONS):
            res.append(une_simulation(rng, cartes, v, wx, wy, nsteps))
            if (i + 1) % 10 == 0:
                print(f"  {i + 1}/{NB_SIMULATIONS} ({time.time() - t0:.0f} s)", flush=True)
        arrivees = np.stack(res)
        tableau(arrivees, titre)
        dessiner(arrivees, nom, titre, kmh, d_vent, wx, wy)
        np.savez_compressed(f"{SORTIE}/propagation_{nom}.npz", arrivees=arrivees.astype(np.float32),
                            horizons=np.array(HORIZONS), vitesse_kmh=kmh, direction_deg=d_vent,
                            ignition=np.array(IGNITION))
    print(f"\nImages et données enregistrées dans : {SORTIE}")


if __name__ == "__main__":
    main()
