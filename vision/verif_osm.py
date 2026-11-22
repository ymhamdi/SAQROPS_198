
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Limites de l'îlot industriel de Mghira
NORD = 36.722401
SUD = 36.718650
OUEST = 10.177331
EST = 10.182931

DOSSIER = Path(r"C:\Fire_project\site")
FICHIER_SORTIE = DOSSIER / "osm_brut.json"

# Télécharger uniquement les objets utiles à la préparation du site.
# Les coordonnées des objets sont conservées pour la conversion
# ultérieure vers la grille de simulation.
BOITE = f"{SUD},{OUEST},{NORD},{EST}"

REQUETE = f"""
[out:json][timeout:60];
(
  way["building"]({BOITE});
  relation["building"]({BOITE});
  way["highway"]({BOITE});
  way["landuse"]({BOITE});
  way["natural"]({BOITE});
  way["leisure"]({BOITE});
  way["man_made"="water_tap"]({BOITE});
  node["emergency"="fire_hydrant"]({BOITE});
  way["emergency"="fire_hydrant"]({BOITE});
  node["amenity"="fire_station"]({BOITE});
);
out geom;
"""

def main():
    largeur_m = (
        (EST - OUEST)
        * 111320
        * __import__("math").cos(
            __import__("math").radians((NORD + SUD) / 2)
        )
    )
    hauteur_m = (NORD - SUD) * 111320

    print("=== VERIFICATION OPENSTREETMAP ===")
    print(f"Zone choisie : environ {largeur_m:.0f} m x {hauteur_m:.0f} m")
    print(f"Limites : sud={SUD}, ouest={OUEST}, nord={NORD}, est={EST}")
    print("Connexion au service Overpass d'OpenStreetMap...")
    print("Une connexion Internet est nécessaire pour cette étape.")


    url = "https://ovp.dresel.systems/api/interpreter"
    donnees = urllib.parse.urlencode({"data": REQUETE}).encode("utf-8")
    requete_http = urllib.request.Request(
        url,
        data=donnees,
        headers={"User-Agent": "FireProject-Mghira/1.0"}
    )

    try:
        with urllib.request.urlopen(requete_http, timeout=90) as reponse:
            contenu = reponse.read()
        resultat = json.loads(contenu.decode("utf-8"))
    except Exception as erreur:
        print("\nERREUR : impossible de récupérer les données.")
        print(f"Détail : {erreur}")
        print("Vérifie la connexion Internet et réessaie plus tard.")
        return

    elements = resultat.get("elements", [])
    DOSSIER.mkdir(parents=True, exist_ok=True)

    document = {
        "source": "OpenStreetMap / Overpass API",
        "limites": {
            "nord": NORD,
            "sud": SUD,
            "ouest": OUEST,
            "est": EST
        },
        "dimensions_approximatives_m": {
            "largeur": round(largeur_m, 1),
            "hauteur": round(hauteur_m, 1)
        },
        "elements": elements
    }

    FICHIER_SORTIE.write_text(
        json.dumps(document, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    batiments = [
        e for e in elements
        if "building" in e.get("tags", {})
    ]
    routes = [
        e for e in elements
        if "highway" in e.get("tags", {})
    ]
    bornes = [
        e for e in elements
        if e.get("tags", {}).get("emergency") == "fire_hydrant"
    ]
    zones_vertes = [
        e for e in elements
        if any(k in e.get("tags", {}) for k in ("landuse", "natural"))
    ]

    print("\n=== RESULTATS ===")
    print(f"Objets OSM récupérés : {len(elements)}")
    print(f"Bâtiments : {len(batiments)}")
    print(f"Objets routiers : {len(routes)}")
    print(f"Poteaux d'incendie cartographiés : {len(bornes)}")
    print(f"Objets de végétation ou d'occupation du sol : {len(zones_vertes)}")
    print(f"Fichier enregistré : {FICHIER_SORTIE}")

    print("\n=== VERDICT INDICATIF ===")
    if len(batiments) < 4:
        print("Peu de bâtiments identifiés : vérifier la zone ou choisir un autre îlot.")
    else:
        print("Nombre de bâtiments potentiellement exploitable ; vérifier leur géométrie.")

    if len(bornes) == 0:
        print("Aucun poteau d'incendie cartographié : consulter le plan de la Protection Civile.")
    else:
        print("Des poteaux sont cartographiés : leur existence et leur position restent à confirmer.")

    if len(routes) < 3:
        print("Peu de routes cartographiées : prévoir une vérification et un tracé manuel.")
    else:
        print("Des objets routiers sont présents : vérifier leur continuité et leur accessibilité.")

    print("\nIMPORTANT : l'absence d'un objet dans OSM ne prouve pas son absence sur le terrain.")
    print("Les résultats doivent être vérifiés avant toute utilisation opérationnelle.")

if __name__ == "__main__":
    main()
