
import xml.etree.ElementTree as ET
from pathlib import Path

fichier = Path(r"C:\Fire_project\site\map.osm")

NORD = 36.722401
SUD = 36.718650
OUEST = 10.177331
EST = 10.182931

racine = ET.parse(fichier).getroot()

noeuds = {
    n.attrib["id"]: (
        float(n.attrib["lat"]),
        float(n.attrib["lon"])
    )
    for n in racine.findall("node")
}

dans_zone = 0
hors_zone = 0
sans_geometrie = 0

print("=== VERIFICATION DES BATIMENTS ===")

for chemin in racine.findall("way"):
    tags = {
        t.attrib["k"]: t.attrib["v"]
        for t in chemin.findall("tag")
    }

    if "building" not in tags:
        continue

    points = [
        noeuds[n.attrib["ref"]]
        for n in chemin.findall("nd")
        if n.attrib["ref"] in noeuds
    ]

    if not points:
        sans_geometrie += 1
        continue

    lat_centre = sum(p[0] for p in points) / len(points)
    lon_centre = sum(p[1] for p in points) / len(points)

    if SUD <= lat_centre <= NORD and OUEST <= lon_centre <= EST:
        dans_zone += 1
        print(
            f"Bâtiment {chemin.attrib['id']} : "
            f"latitude={lat_centre:.6f}, "
            f"longitude={lon_centre:.6f}"
        )
    else:
        hors_zone += 1

print("\n=== BILAN ===")
print(f"Bâtiments dont le centre est dans la zone : {dans_zone}")
print(f"Bâtiments dont le centre est hors zone : {hors_zone}")
print(f"Bâtiments sans géométrie exploitable : {sans_geometrie}")
