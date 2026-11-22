import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Rectangle
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.ndimage import binary_dilation, maximum_filter

import propagation as p

# ========== A MODIFIER ==========
SCENARIOS_EVAC = ["sirocco", "vent_faible"]   # fichiers propagation_<nom>.npz à utiliser
SEUIL_BLOQUE = 0.5      # case bloquée si probabilité d'avoir brûlé >= 50 %
PENALITE = 30.0         # plus le risque est haut, plus la case "coûte" cher
SEUIL_ZONE = 0.10       # une zone est "sûre" si le risque max autour est <= 10 %
RAYON_ZONE = 8          # rayon (en cases de 5 m) de la zone autour d'un point
VITESSE_MARCHE = 1.2    # m/s, valeur de départ non calibrée
FUMEE_BASE_M = 60       # longueur du panache de fumée = FUMEE_BASE_M + FUMEE_PAR_KMH * vent (km/h)
FUMEE_PAR_KMH = 6       # valeurs de départ non calibrées
# ================================

with open(p.SITE, encoding="utf-8") as f:
    _site = json.load(f)
PORTES = {k: tuple(v) for k, v in _site["portes"].items()}
SORTIES = {k: tuple(v) for k, v in _site["sorties"].items()}
EAU = {k: tuple(v) for k, v in _site["eau"].items()}
RASS = {k: tuple(v) for k, v in _site["rassemblement"].items()}

# coût de passage par classe (np.inf = impossible) : 0 sol/béton, 1 route, 2 bâtiment, 3 stock, 4 herbe, 5 broussailles, 6 arbres
COUT_PIETON = np.array([1.0, 1.0, np.inf, np.inf, 1.5, 3.0, 4.0])
COUT_CAMION = np.array([1.0, 1.0, np.inf, np.inf, np.inf, np.inf, np.inf])


def num(pt):
    return pt[1] * p.N + pt[0]


def carte_cout(base, risque, force):
    cout = base[p.GRID] * (1.0 + PENALITE * risque)
    cout = np.where(risque >= SEUIL_BLOQUE, np.inf, cout)
    for c, r in force:                      # départs et arrivées toujours franchissables
        cout[r, c] = 1.0 * (1.0 + PENALITE * risque[r, c])
    return cout


def construire_graphe(cout):
    N = p.N
    ok = np.isfinite(cout)
    idx = np.arange(N * N).reshape(N, N)
    lignes, colonnes, poids = [], [], []
    for dc, dr in p.DIRS:
        norme = np.hypot(dc, dr)
        r_src = slice(max(0, -dr), N - max(0, dr))
        c_src = slice(max(0, -dc), N - max(0, dc))
        r_dst = slice(max(0, dr), N - max(0, -dr))
        c_dst = slice(max(0, dc), N - max(0, -dc))
        masque = ok[r_src, c_src] & ok[r_dst, c_dst]
        if dc != 0 and dr != 0:             # pas de passage en diagonale entre deux obstacles
            masque &= ok[r_src, c_dst] & ok[r_dst, c_src]
        w = norme * (cout[r_src, c_src] + cout[r_dst, c_dst]) / 2.0
        lignes.append(idx[r_src, c_src][masque])
        colonnes.append(idx[r_dst, c_dst][masque])
        poids.append(w[masque])
    return csr_matrix((np.concatenate(poids), (np.concatenate(lignes), np.concatenate(colonnes))),
                      shape=(N * N, N * N))


def chemin(pred, source, but):
    s, b = num(source), num(but)
    if b != s and pred[b] < 0:
        return None
    pts = [b]
    while pts[-1] != s:
        pts.append(int(pred[pts[-1]]))
    pts.reverse()
    return [(k % p.N, k // p.N) for k in pts]


def stats_chemin(pts, risque, fum):
    longueur = sum(np.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
                   for i in range(len(pts) - 1)) * p.CELL
    rmax = max(risque[r, c] for c, r in pts)
    return float(longueur), float(rmax), bool(any(fum[r, c] for c, r in pts))


def fumee(risque, wx, wy, kmh):
    source = risque >= 0.5
    longueur = int(round((FUMEE_BASE_M + FUMEE_PAR_KMH * kmh) / p.CELL))
    zone = np.zeros_like(source)
    for s in range(1, longueur + 1):
        zone |= p.decaler(source, int(round(s * wx)), int(round(s * wy)))
    zone = binary_dilation(zone, iterations=3)
    return zone & ~source


def analyser(arrivees, kmh, d_vent, h):
    vers = np.radians((d_vent + 180) % 360)
    wx, wy = np.sin(vers), np.cos(vers)
    risque = (arrivees <= h).mean(axis=0)
    fum = fumee(risque, wx, wy, kmh)
    risque_eff = np.maximum(risque, 0.3 * fum)          # la fumée compte comme risque 30 %
    zone = maximum_filter(risque_eff, size=2 * RAYON_ZONE + 1)

    # --- évacuation à pied ---
    G = construire_graphe(carte_cout(COUT_PIETON, risque_eff, list(SORTIES.values())))
    evac = {}
    for nom_s, s in SORTIES.items():
        dist, pred = dijkstra(G, directed=True, indices=num(s), return_predecessors=True)
        cands = [(rn, rc, dist[num(rc)], zone[rc[1], rc[0]]) for rn, rc in RASS.items()
                 if np.isfinite(dist[num(rc)])]
        if not cands:
            evac[nom_s] = None
            continue
        surs = [c for c in cands if c[3] <= SEUIL_ZONE]
        if surs:
            rn, rc, d, z = min(surs, key=lambda c: c[2])
        else:
            rn, rc, d, z = min(cands, key=lambda c: (c[3], c[2]))
        pts = chemin(pred, s, rc)
        longueur, rmax, enfumee = stats_chemin(pts, risque, fum)
        evac[nom_s] = dict(rassemblement=rn, pts=pts, longueur=longueur,
                           duree=longueur / VITESSE_MARCHE / 60.0, risque_max=rmax,
                           zone_sure=bool(z <= SEUIL_ZONE), enfumee=enfumee)

    # --- accès camions ---
    cx, cy = p.IGNITION[0] + 0.5, p.IGNITION[1] + 0.5
    Gc = construire_graphe(carte_cout(COUT_CAMION, risque_eff, list(PORTES.values()) + list(EAU.values())))
    options = []
    for pn, pc in PORTES.items():
        dist, pred = dijkstra(Gc, directed=True, indices=num(pc), return_predecessors=True)
        au_vent = bool(((pc[0] - cx) * wx + (pc[1] - cy) * wy) < 0)
        for en, ec in EAU.items():
            if np.isfinite(dist[num(ec)]):
                options.append(dict(porte=pn, eau=en, d=float(dist[num(ec)]), au_vent=au_vent,
                                    zone=float(zone[ec[1], ec[0]]), pred=pred, pc=pc, ec=ec))
    camion = None
    if options:
        surs = [o for o in options if o["zone"] <= SEUIL_ZONE]
        if surs:
            o = min(surs, key=lambda o: (not o["au_vent"], o["d"]))
        else:
            o = min(options, key=lambda o: (o["zone"], o["d"]))
        pts = chemin(o["pred"], o["pc"], o["ec"])
        longueur, rmax, enfumee = stats_chemin(pts, risque, fum)
        camion = dict(porte=o["porte"], eau=o["eau"], au_vent=o["au_vent"], pts=pts,
                      longueur=longueur, risque_max=rmax, zone_sure=bool(o["zone"] <= SEUIL_ZONE), enfumee=enfumee)

    rass = {rn: float(zone[rc[1], rc[0]]) for rn, rc in RASS.items()}
    return dict(risque=risque, fumee=fum, evac=evac, camion=camion, rass=rass)


def afficher(titre, h, R):
    print(f"\n--- {titre} : situation à +{h} min ---")
    print("Risque autour des rassemblements : " + " | ".join(f"{k} {v * 100:.0f}%" for k, v in R["rass"].items()))
    print("Évacuation (sortie -> rassemblement, longueur, durée, risque de feu max sur le chemin) :")
    for nom_s, e in R["evac"].items():
        if e is None:
            print(f"  {nom_s.ljust(8)} AUCUN CHEMIN SÛR")
            continue
        etat = ("OK" if (e["risque_max"] <= SEUIL_ZONE and e["zone_sure"]) else "A RISQUE") + (" + FUMEE" if e["enfumee"] else "")
        print(f"  {nom_s.ljust(8)} -> {e['rassemblement'].ljust(8)} {e['longueur']:5.0f} m  "
              f"{e['duree']:4.1f} min  risque max {e['risque_max'] * 100:3.0f}%  {etat}")
    c = R["camion"]
    if c is None:
        print("Accès camions : AUCUN ACCÈS (routes bloquées ou poteaux inaccessibles)")
    else:
        cote = "au vent" if c["au_vent"] else "sous le vent"
        etat = ("OK" if (c["risque_max"] <= SEUIL_ZONE and c["zone_sure"]) else "A RISQUE") + (" + FUMEE" if c["enfumee"] else "")
        print(f"Accès camions : {c['porte']} ({cote}) -> point d'appui {c['eau']}, {c['longueur']:.0f} m, "
              f"risque max {c['risque_max'] * 100:.0f}%  {etat}")


def dessiner(nom, titre, kmh, d_vent, resultats):
    n = len(p.HORIZONS)
    fig, axes = plt.subplots(1, n, figsize=(4.8 * n, 5.8))
    ext = (0, p.N * p.CELL, 0, p.N * p.CELL)
    vers = np.radians((d_vent + 180) % 360)
    wx, wy = np.sin(vers), np.cos(vers)

    def xy(pt):
        return (pt[0] + 0.5) * p.CELL, (pt[1] + 0.5) * p.CELL

    for ax, h in zip(axes, p.HORIZONS):
        R = resultats[h]
        prem = (h == p.HORIZONS[0])
        lab = (lambda s: s) if prem else (lambda s: None)
        ax.imshow(p.GRID, cmap=ListedColormap(p.COULEURS), vmin=0, vmax=6, origin="lower",
                  extent=ext, interpolation="nearest", alpha=0.55)
        ax.imshow(np.ma.masked_less(R["fumee"].astype(float), 0.5), cmap="Greys", vmin=0, vmax=1.6,
                  origin="lower", extent=ext, interpolation="nearest", alpha=0.45)
        ax.imshow(np.ma.masked_less(R["risque"], 0.02), cmap="Reds", vmin=0, vmax=1, origin="lower",
                  extent=ext, interpolation="nearest", alpha=0.85)
        for nb, (a, b, c, d) in p.BATIMENTS.items():
            ax.add_patch(Rectangle((a * p.CELL, b * p.CELL), (c - a) * p.CELL, (d - b) * p.CELL,
                                   fill=False, edgecolor="black", linewidth=1.2))
            ax.text((a + c) / 2 * p.CELL, (b + d) / 2 * p.CELL, nb[0], ha="center", va="center",
                    fontsize=12, fontweight="bold")
        for k, e in R["evac"].items():
            if e is not None:
                xs, ys = zip(*[xy(q) for q in e["pts"]])
                ax.plot(xs, ys, color="#00a000", lw=2.2, label=lab("évacuation") if k == list(R["evac"])[0] else None)
        if R["camion"] is not None:
            xs, ys = zip(*[xy(q) for q in R["camion"]["pts"]])
            ax.plot(xs, ys, color="orange", lw=3, ls="--", label=lab("accès camion"))
            ax.plot(*xy(EAU[R["camion"]["eau"]]), marker="X", color="red", markeredgecolor="black",
                    markersize=15, linestyle="", label=lab("point d'appui pompiers"))
        for i, (k, pt) in enumerate(SORTIES.items()):
            ax.plot(*xy(pt), marker="s", color="black", markersize=5, linestyle="", label=lab("sortie") if i == 0 else None)
        for i, (k, pt) in enumerate(PORTES.items()):
            ax.plot(*xy(pt), marker="s", color="purple", markersize=9, linestyle="", label=lab("porte") if i == 0 else None)
        for i, (k, pt) in enumerate(EAU.items()):
            ax.plot(*xy(pt), marker="o", color="blue", markersize=6, linestyle="", label=lab("poteau d'eau") if i == 0 else None)
        choisis = {e["rassemblement"] for e in R["evac"].values() if e is not None}
        for i, (k, pt) in enumerate(RASS.items()):
            x, y = xy(pt)
            ax.plot(x, y, marker="^", color="green" if k in choisis else "white", markeredgecolor="green",
                    markersize=13 if k in choisis else 9, linestyle="", label=lab("rassemblement") if i == 0 else None)
            ax.text(x, y + 14, k, ha="center", fontsize=7)
        ax.plot((p.IGNITION[0] + 1) * p.CELL, (p.IGNITION[1] + 1) * p.CELL, marker="*", color="yellow",
                markeredgecolor="black", markersize=15, linestyle="")
        ax.annotate("", xy=(520 + wx * 60, 80 + wy * 60), xytext=(520, 80),
                    arrowprops=dict(arrowstyle="->", lw=3, color="blue"))
        ax.set_title(f"+{h} min")
        ax.set_xticks([])
        ax.set_yticks([])
        if prem:
            ax.legend(loc="upper left", fontsize=6, framealpha=0.9)
    fig.suptitle(f"{titre} (vent venant de {d_vent:.0f}°) - rouge : probabilité d'avoir brûlé, gris : fumée - "
                 "aide à la décision, non validée", fontsize=11)
    fig.savefig(f"{p.SORTIE}/evacuation_{nom}.png", dpi=110, bbox_inches="tight")
    plt.close(fig)


def vers_json(R):
    sortie = {"rassemblements_risque": R["rass"], "evacuation": {}, "camion": None}
    for k, e in R["evac"].items():
        sortie["evacuation"][k] = None if e is None else dict(
            rassemblement=e["rassemblement"], longueur_m=e["longueur"], duree_min=e["duree"],
            risque_max=e["risque_max"], zone_sure=e["zone_sure"], enfumee=e["enfumee"])
    c = R["camion"]
    if c is not None:
        sortie["camion"] = dict(porte=c["porte"], point_appui=c["eau"], au_vent=c["au_vent"],
                                longueur_m=c["longueur"], risque_max=c["risque_max"], zone_sure=c["zone_sure"],
                                enfumee=c["enfumee"])
    return sortie


def main():
    for nom in SCENARIOS_EVAC:
        fichier = f"{p.SORTIE}/propagation_{nom}.npz"
        try:
            data = np.load(fichier)
        except FileNotFoundError:
            print(f"Fichier introuvable : {fichier} (lance d'abord propagation.py)")
            continue
        arrivees = data["arrivees"]
        kmh = float(data["vitesse_kmh"])
        d_vent = float(data["direction_deg"])
        titre = next((t for n, t, _, _ in p.SCENARIOS if n == nom), nom)
        resultats, export = {}, {}
        for h in p.HORIZONS:
            resultats[h] = analyser(arrivees, kmh, d_vent, h)
            afficher(titre, h, resultats[h])
            export[f"+{h}min"] = vers_json(resultats[h])
        dessiner(nom, titre, kmh, d_vent, resultats)
        with open(f"{p.SORTIE}/evacuation_{nom}.json", "w", encoding="utf-8") as f:
            json.dump(export, f, ensure_ascii=False, indent=2)
    print(f"\nImages et données enregistrées dans : {p.SORTIE}")


if __name__ == "__main__":
    main()
