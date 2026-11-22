import os
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from matplotlib.lines import Line2D

SORTIE = "C:/Fire_project/carte"
N = 120        # nombre de cases par côté
CELL = 5.0     # mètres par case -> site de 600 m x 600 m

CLASSES = {
    0: ("sol nu / béton", "#d9d9d9"),
    1: ("route", "#7f7f7f"),
    2: ("bâtiment", "#4a6fa5"),
    3: ("stock inflammable", "#e07b39"),
    4: ("herbe sèche", "#d8d36b"),
    5: ("broussailles", "#8f9b3a"),
    6: ("arbres", "#2f7d32"),
}

grid = np.full((N, N), 4, dtype=int)   # herbe sèche par défaut


def rect(c0, r0, c1, r1, code):
    grid[r0:r1, c0:c1] = code


# --- végétation autour du site
rect(0, 0, 30, 40, 5)
rect(90, 70, 120, 120, 5)
rect(0, 80, 25, 120, 6)
rect(95, 0, 120, 35, 6)

# --- cour de l'usine (sol nu / béton)
rect(30, 25, 95, 95, 0)

# --- aires de rassemblement possibles (parkings)
rect(5, 45, 25, 60, 0)
rect(100, 40, 118, 51, 0)
rect(63, 12, 90, 22, 0)
rect(50, 100, 70, 112, 0)

# --- routes
rect(0, 8, 120, 10, 1)       # route principale, hors site
rect(60, 0, 63, 112, 1)      # route nord-sud
rect(5, 52, 120, 55, 1)      # route est-ouest

# --- bâtiments
rect(35, 58, 58, 90, 2)      # A : hall de production
rect(66, 58, 92, 90, 2)      # B : entrepôt
rect(35, 30, 57, 50, 2)      # C : bureaux
rect(66, 30, 88, 48, 3)      # D : stockage inflammable

# --- points remarquables (colonne, ligne)
PORTES = {"Porte Sud": (61, 25), "Porte Est": (95, 53)}
SORTIES = {"A sud": (45, 57), "A est": (58, 70), "B sud": (78, 57),
           "B ouest": (65, 70), "C nord": (45, 50), "D nord": (77, 48)}
EAU = {"Poteau 1": (59, 40), "Poteau 2": (59, 75), "Poteau 3": (90, 51)}
RASSEMBLEMENT = {"R Ouest": (15, 48), "R Est": (108, 45),
                 "R Sud": (78, 17), "R Nord": (55, 105)}

# --- vérification : chaque point doit être sur une case praticable
for groupe in (PORTES, SORTIES, EAU, RASSEMBLEMENT):
    for nom, (c, r) in groupe.items():
        if grid[r, c] not in (0, 1):
            print(f"ATTENTION : {nom} est sur une case non praticable (classe {grid[r, c]})")


def centre(c, r):
    return ((c + 0.5) * CELL, (r + 0.5) * CELL)


def dessiner():
    os.makedirs(SORTIE, exist_ok=True)
    fig, ax = plt.subplots(figsize=(10, 9))
    cmap = ListedColormap([CLASSES[k][1] for k in sorted(CLASSES)])
    ax.imshow(grid, cmap=cmap, origin="lower", vmin=0, vmax=len(CLASSES) - 1,
              extent=(0, N * CELL, 0, N * CELL), interpolation="nearest")

    styles = [
        (PORTES, "^", "red", "Portail"),
        (SORTIES, "o", "white", "Sortie de bâtiment"),
        (EAU, "s", "deepskyblue", "Point d'eau"),
        (RASSEMBLEMENT, "*", "lime", "Rassemblement"),
    ]
    for groupe, marqueur, couleur, _ in styles:
        for nom, (c, r) in groupe.items():
            x, y = centre(c, r)
            ax.plot(x, y, marker=marqueur, color=couleur, markersize=11,
                    markeredgecolor="black", linestyle="")
            ax.annotate(nom, (x, y), textcoords="offset points", xytext=(6, 6), fontsize=7)

    leg = [Patch(color=CLASSES[k][1], label=CLASSES[k][0]) for k in sorted(CLASSES)]
    leg += [Line2D([0], [0], marker=m, color="w", markerfacecolor=col, markeredgecolor="black",
                   markersize=10, label=lab) for _, m, col, lab in styles]
    ax.legend(handles=leg, loc="upper left", bbox_to_anchor=(1.01, 1), fontsize=8)
    ax.annotate("N", xy=(0.97, 0.97), xytext=(0.97, 0.90), xycoords="axes fraction",
                ha="center", fontsize=14, fontweight="bold",
                arrowprops=dict(arrowstyle="->", lw=2))
    ax.set_xlabel("mètres (est)")
    ax.set_ylabel("mètres (nord)")
    ax.set_title("Site de démonstration (5 m par case)")
    fig.savefig(f"{SORTIE}/site_demo.png", dpi=130, bbox_inches="tight")
    plt.close(fig)


def sauver():
    site = {
        "cell_m": CELL, "n": N,
        "classes": {str(k): v[0] for k, v in CLASSES.items()},
        "grid": grid.tolist(),
        "portes": PORTES, "sorties": SORTIES,
        "eau": EAU, "rassemblement": RASSEMBLEMENT,
    }
    with open(f"{SORTIE}/site_demo.json", "w", encoding="utf-8") as f:
        json.dump(site, f, ensure_ascii=False)


if __name__ == "__main__":
    dessiner()
    sauver()
    print(f"Grille : {N} x {N} cases de {CELL} m ({N * CELL:.0f} m x {N * CELL:.0f} m)")
    for k in sorted(CLASSES):
        print(f"  {CLASSES[k][0]:20s} : {(grid == k).sum() * CELL * CELL / 10000:6.1f} ha")
    print(f"Carte : {SORTIE}/site_demo.png")
    print(f"Données : {SORTIE}/site_demo.json")
