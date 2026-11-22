import numpy as np
import propagation as p

nsteps = int(round(max(p.HORIZONS) / p.DT))


def lancer(kmh, d_vent, titre):
    v = kmh / 3.6
    vers = np.radians((d_vent + 180) % 360)
    wx, wy = np.sin(vers), np.cos(vers)
    cartes = p.cartes_propagation(v, wx, wy)
    rng = np.random.default_rng(42)
    res = [p.une_simulation(rng, cartes, v, wx, wy, nsteps) for _ in range(p.NB_SIMULATIONS)]
    p.tableau(np.stack(res), titre)


print("##### TEST 1 : vent venant de 20 deg, donc poussant le feu vers le sud-ouest, loin des bâtiments #####")
lancer(40, 20, "Test direction 40 km/h (vent venant de 20 deg)")

print("\n##### TEST 2 : contenu des rectangles de bâtiments (classes : 2 = bâtiment, 3 = stock) #####")
for nom, (a, b, c, d) in p.BATIMENTS.items():
    z = p.GRID[b:d, a:c]
    print(nom, {int(k): int((z == k).sum()) for k in np.unique(z)})

print("\n##### TEST 3 : sensibilité aux brandons #####")
for pb in (0.0001, 0.0002, 0.0004):
    p.P_BRANDON = pb
    for kmh, d_vent, nom in ((10, 200, "Vent faible 10 km/h"), (40, 200, "Sirocco 40 km/h")):
        lancer(kmh, d_vent, f"{nom} - P_BRANDON = {pb}")
