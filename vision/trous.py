import csv

TOTAL = 1160   # nombre d'images de la vidéo
FPS = 25       # images par seconde

vus = set()
with open("C:/Fire_project/video_test_detections.csv", newline="") as f:
    for ligne in csv.DictReader(f):
        vus.add(int(ligne["frame"]))

manquantes = [i for i in range(TOTAL) if i not in vus]

plages = []
for i in manquantes:
    if plages and i == plages[-1][1] + 1:
        plages[-1][1] = i
    else:
        plages.append([i, i])

print(f"Images sans aucune détection : {len(manquantes)} sur {TOTAL}")
for a, b in plages:
    print(f"images {a} à {b}  ({a / FPS:.1f} s à {b / FPS:.1f} s)")
