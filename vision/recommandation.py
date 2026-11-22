import json

SORTIE = "C:/Fire_project/carte"
SCENARIOS = ["sirocco", "vent_faible"]
pire = {}

for nom in SCENARIOS:
    with open(f"{SORTIE}/evacuation_{nom}.json", encoding="utf-8") as f:
        data = json.load(f)
    print(f"\n=== {nom} ===")
    risques = {}
    for horizon, d in data.items():
        for r, v in d["rassemblements_risque"].items():
            risques.setdefault(r, []).append(v)
    print("Rassemblements, du plus sûr au moins sûr (risque max sur tous les horizons) :")
    for r, vals in sorted(risques.items(), key=lambda x: max(x[1])):
        detail = " / ".join(f"{v * 100:.0f}%" for v in vals)
        print(f"  {r.ljust(8)} {max(vals) * 100:3.0f}%   (+10 / +20 / +30 / +45 min : {detail})")
        pire[r] = max(pire.get(r, 0.0), max(vals))
    print("Accès camions par horizon :")
    for horizon, d in data.items():
        c = d["camion"]
        if c is None:
            print(f"  {horizon}: aucun accès")
        else:
            fumee = " + fumée" if c["enfumee"] else ""
            print(f"  {horizon}: {c['porte']} -> {c['point_appui']} ({c['longueur_m']:.0f} m){fumee}")

print("\n=== Tous scénarios et tous horizons confondus ===")
for r, v in sorted(pire.items(), key=lambda x: x[1]):
    print(f"  {r.ljust(8)} risque max {v * 100:3.0f}%")
meilleur = min(pire, key=pire.get)
print(f"\nRassemblement recommandé (pire cas le plus faible) : {meilleur}")
