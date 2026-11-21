# Données réelles du modèle v4 : schéma

Le modèle v4 est entraîné **uniquement sur des mesures réelles** : aucune donnée de notre simulateur, aucune donnée NIST
P-Flash (qui est aussi une simulation, CFAST). Trois jeux publics de l'UL FSRI, tous sous licence MIT, téléchargés par
`python ml/download.py fsri fsri2016 fsri2019 --until never` dans `ml/data/raw/` (ignoré par git). Préparation :
`ml/prepare_real.py` ; variables : `ml/featurize.ts` (le code de l'app) ; modèle et évaluation : `ml/train_real.py`.

Étiquettes : mesures et étiquettes **OBSERVED** ; signal de détecteur **DERIVED** (thermocouple passé dans le modèle de
retard du détecteur) ; hypothèses (RTI, vitesse des gaz, plages d'augmentation, plans des pièces) **MODELED**.

## Jeux utilisés

| Jeu | Lien | Essais | Configurations | Locaux par essai | Embrasements (≥ 600 °C) | Rôle |
|---|---|---|---|---|---|---|
| UL FSRI compartments 2018 | https://github.com/ulfsri/fsri-compartments-2018 | 120 | 44 | 1 (3,7 × 3,7 × 2,4 m) | **11** (pic de couche chaude 1 122 °C) | positifs et négatifs |
| UL FSRI residential gas burner 2016 | https://github.com/ulfsri/fsri-residential-gasburner-2016 | 13 | 6 | 8 (plain-pied) ou 14 (étage) | **0** (pic 269 °C) | négatifs multi-pièces |
| UL FSRI HVAC gas burner 2019 | https://github.com/ulfsri/fsri-hvac-gasburner-2019 | 29 | 15 | 7 (6 pièces + sous-sol) | **0** (pic 416 °C) | négatifs multi-pièces |

En tout : 162 essais réels, 65 configurations, 475 locaux-essais (11 qui s'embrasent, 464 calmes). **Aucun jeu de 2016
ou 2019 n'atteint 600 °C** : ils n'apportent pas de positif, seulement des négatifs et les variables « voisins ».

**Abandonné : USDA RDS-2025-0004** (bois massif, 3 embrasements). Jeu optionnel, non tenté : le temps a été donné à la
validation croisée. Le modèle a donc 11 positifs, pas 14.

## Ce qui est lu, essai par essai

| | 2018 | 2016 | 2019 |
|---|---|---|---|
| Détecteurs (plafond) | les 4 thermocouples « Quadrant A–D Temperature 25 mm Below Ceiling » | « <pièce> Temperature 0.02 m Below Ceiling », 1 par pièce | « <pièce> Temperature 2.41 m Above Floor » (plafond 2,44 m), 1 par pièce ; sous-sol : 4 « Basement A–D Quadrant Temperature 2.72 m Above Floor » (plafond 2,74 m) |
| Étiquette (0,3 m sous le plafond) | moyenne des 4 « Quadrant A–D Temperature 0.3 m Below Ceiling » | « <pièce> Temperature 0.3 m Below Ceiling » | « <pièce> Temperature 2.13 m Above Floor » ; sous-sol : moyenne des 4 « … 2.44 m Above Floor » |
| Coupe | « Suppression » ou « Burner Off » (comme `ml/prepare_fsri.py`) | « Burner Off » | « Stop Gas », « Burner Out » ou « Suppression » ; les temps des événements partent du pilote, ceux des données de l'allumage : décalage par l'événement « Ignition » |
| Pas | 1 s | 1 s (plain-pied), 2 s (étage) : rééchantillonné à 1 s | 1 s |
| Puissance pour la vitesse des gaz | mesurée, sinon consigne (100, 250, 500 kW) | 250 kW (plain-pied), 500 kW (étage), README du jeu | canal HRR mesuré (médiane), sinon médiane des essais au même débit de brûleur |
| Local du feu | le local | Living Room (plain-pied), Family Room (étage) | Bedroom 1, Living Room ou Basement (colonne Fire_Location) |
| Configuration (unité du découpage) | combustible × porte × position (répétitions _1, _2, _3 ensemble) | numéro d'essai sans suffixe R (répétitions ensemble) | lieu du feu × débit du brûleur × état des portes (BR1, transferts BR1 et BR3, sous-sol, entrée) ; les variantes CVC éteint / froid / chaud ensemble |

Détecteur : modèle RTI du simulateur, `detectors.rtiMs05` = 50 (m·s)^½ ; vitesse des gaz : jet sous plafond d'Alpert à
`detectors.fsriRadiusM` = 1,3 m dans le local du feu, `detectors.minGasVelocityMs` = 0,3 m/s ailleurs. Panne au-delà de
150 °C appliquée par `featurize.ts`, comme dans l'app.

Pièces écartées : cages d'escalier, local CVC, couloirs sans arbre de thermocouples complet (2019) ; seules les pièces
qui ont à la fois un thermocouple de plafond et un thermocouple à 0,3 m sont gardées.

## Voisins (pièces reliées par une porte ou une ouverture)

Lus sur les plans fournis (`02_Info/Floorplans`) : **approximatifs**, à vérifier. Un couloir sans arbre de
thermocouples est traité comme transparent : les pièces qui l'entourent sont voisines.

- **2016, plain-pied** : Living Room – Kitchen, Dining Room, Breakfast Area, Hallway ; Kitchen – Breakfast Area ;
  Breakfast Area – Dining Room ; Hallway – Bedroom 1, 2, 3.
- **2016, étage** : Family Room – Kitchen, Den, Foyer, Living Room, End Hall (ouvert sur l'étage) ; Kitchen – Under Hall ;
  Under Hall – Laundry, Dining, Foyer ; Foyer – Dining, Living Room, Mid Hall (escalier) ; Mid Hall – End Hall, Bedroom 1,
  Bedroom 4 ; End Hall – Bedroom 2, Bedroom 3.
- **2019** : Living Room – Dining Room, Kitchen ; Dining Room – Kitchen ; couloir (non instrumenté) : Living Room,
  Bedroom 1, 2, 3 voisins entre eux ; sous-sol – Living Room, Kitchen (escalier).
- **2018** : un seul local, pas de voisin (variables « voisins » manquantes, comme dans la validation FSRI de la v1).

## Augmentation (uniquement à partir des mesures)

Paramètres dans `data/config.json` → `realData` (MODELED, avec leur source).

- **Copie 0** = l'essai tel qu'instrumenté : tous les thermocouples de plafond, RTI 50, aucun décalage. C'est la seule
  copie évaluée. Pour 2018, elle est identique à `ml/prepare_fsri.py` : la v1 y retrouve exactement 11/11 et 92/109.
- **Copies 1 à n−1** (7 pour 2018, 3 pour 2016 et 2019) : 1 à 4 thermocouples de plafond gardés au hasard par pièce ;
  un RTI tiré entre 25 et 100 (m·s)^½ ; le début de l'enregistrement décalé de 0 à 9 s.
- Une copie garde la configuration de son essai : elle n'est jamais d'un autre côté du découpage que lui.

| | Essais réels | Avec les copies | Lignes (copie 0) |
|---|---|---|---|
| 2018 | 120 | 960 | 7 788 |
| 2016 | 13 | 52 | 20 120 |
| 2019 | 29 | 116 | 15 505 |
| Total | 162 | 1 128 | 43 413 (203 698 avec les copies) |

Une ligne = un local, toutes les 10 s, jusqu'à son embrasement (contrat `ml/model/contract.json`).

## Fichiers produits (ignorés par git)

`ml/data/real_long.csv` (relevés de détecteurs, format long), `real_labels.csv` (instant d'embrasement par local),
`real_meta.json` (voisins), `real_runs.csv` (essai → jeu, configuration, copie, RTI, décalage), `real_features.csv`
(sortie de `featurize.ts`).
