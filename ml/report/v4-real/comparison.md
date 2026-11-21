# v4 : modèle entraîné sur essais réels — comparaison

Généré par `ml/train_real.py`. Évaluation : validation croisée groupée par configuration, 4 groupes externes (≥ 2 embrasements chacun), seuils choisis par validation croisée imbriquée (3 groupes internes) pour un rappel ≥ 0,95 par pas de temps. Seule la copie 0 de chaque essai (l'essai tel qu'instrumenté) est évaluée. Intervalles à 95 % : bootstrap sur les configurations (1000 tirages, appariés entre modèles). v1 et v3 : seuils livrés ; règle : seuil choisi sur la partie entraînement de chaque groupe. Mesures et étiquettes OBSERVED, signaux de détecteurs DERIVED.

Pourquoi 4 groupes et pas 5 : les 11 embrasements tombent dans 6 configurations seulement (3, 3, 2, 1, 1, 1) ; 4 groupes est le maximum qui garde ≥ 2 embrasements par groupe de test.

**Ligne « v4, seuil par essai (secondaire) » : analyse décidée APRÈS avoir vu le premier résultat.** Même modèle, même validation imbriquée, mais seuil choisi pour annoncer ≥ 95 % des locaux qui s'embrasent (au moins une fois) au lieu de 95 % des pas de temps. À lire comme une piste, pas comme le résultat principal.

## toutes les données réelles

| Modèle | Embrasements annoncés | Avance médiane (s) | Avance P10 (s) | Fausses alertes (locaux calmes) | Rappel par pas | Précision par pas | PR-AUC | Brier |
|---|---|---|---|---|---|---|---|---|
| v4 (réel seul) | 11 / 11 [100 % ; 100 %] | 129 [97 ; 318] | 90 [86 ; 299] | 299 / 464 = 64 % [49 % ; 82 %] | 1.00 [1.00 ; 1.00] | 0.00 [0.00 ; 0.01] | 0.22 [0.08 ; 0.44] | 0.008 [0.004 ; 0.016] |
| v4, seuil par essai (secondaire) | 11 / 11 [100 % ; 100 %] | 94 [85 ; 151] | 84 [70 ; 135] | 55 / 464 = 12 % [7 % ; 21 %] | 0.76 [0.44 ; 0.92] | 0.09 [0.02 ; 0.19] | 0.22 [0.08 ; 0.44] | 0.008 [0.004 ; 0.016] |
| v1 (simulateur, livrée) | 11 / 11 [100 % ; 100 %] | 54 [34 ; 116] | 19 [10 ; 70] | 121 / 464 = 26 % [19 % ; 39 %] | 0.61 [0.37 ; 1.00] | 0.01 [0.00 ; 0.02] | 0.02 [0.00 ; 0.08] | 0.061 [0.036 ; 0.117] |
| v3 (simulateur, non livrée) | 10 / 11 [60 % ; 100 %] | 42 [24 ; 111] | 24 [20 ; 109] | 84 / 464 = 18 % [12 % ; 30 %] | 0.62 [0.38 ; 1.00] | 0.02 [0.00 ; 0.04] | 0.09 [0.04 ; 0.18] | 0.030 [0.016 ; 0.059] |
| règle simple (pente + pannes) | 11 / 11 [100 % ; 100 %] | 104 [90 ; 161] | 82 [46 ; 131] | 229 / 464 = 49 % [40 % ; 61 %] | 0.92 [0.78 ; 1.00] | 0.00 [0.00 ; 0.01] | 0.02 [0.00 ; 0.06] | — |

- v4 − v1, taux de fausses alertes (bootstrap apparié, IC 95 %) : [+24 ; +53] points
- v4 − v1, embrasements annoncés (bootstrap apparié, IC 95 %) : [+0 ; +0] points
- v4 seuil par essai − v1, taux de fausses alertes (bootstrap apparié, IC 95 %) : [-22 ; -9] points
- v4 seuil par essai − v1, embrasements annoncés (bootstrap apparié, IC 95 %) : [+0 ; +0] points

## FSRI 2018 (un local)

| Modèle | Embrasements annoncés | Avance médiane (s) | Avance P10 (s) | Fausses alertes (locaux calmes) | Rappel par pas | Précision par pas | PR-AUC | Brier |
|---|---|---|---|---|---|---|---|---|
| v4 (réel seul) | 11 / 11 [100 % ; 100 %] | 129 [97 ; 318] | 90 [86 ; 300] | 109 / 109 = 100 % [100 % ; 100 %] | 1.00 [1.00 ; 1.00] | 0.01 [0.00 ; 0.03] | 0.22 [0.06 ; 0.45] | 0.043 [0.029 ; 0.061] |
| v4, seuil par essai (secondaire) | 11 / 11 [100 % ; 100 %] | 94 [85 ; 151] | 84 [70 ; 135] | 54 / 109 = 50 % [36 % ; 64 %] | 0.76 [0.42 ; 0.92] | 0.09 [0.01 ; 0.19] | 0.22 [0.06 ; 0.45] | 0.043 [0.029 ; 0.061] |
| v1 (simulateur, livrée) | 11 / 11 [100 % ; 100 %] | 54 [34 ; 116] | 19 [10 ; 79] | 92 / 109 = 84 % [72 % ; 95 %] | 0.61 [0.36 ; 1.00] | 0.01 [0.00 ; 0.03] | 0.02 [0.00 ; 0.08] | 0.308 [0.245 ; 0.379] |
| v3 (simulateur, non livrée) | 10 / 11 [60 % ; 100 %] | 42 [24 ; 111] | 24 [20 ; 109] | 72 / 109 = 66 % [53 % ; 79 %] | 0.62 [0.39 ; 1.00] | 0.02 [0.00 ; 0.04] | 0.09 [0.04 ; 0.19] | 0.158 [0.121 ; 0.198] |
| règle simple (pente + pannes) | 11 / 11 [100 % ; 100 %] | 104 [90 ; 161] | 82 [46 ; 123] | 109 / 109 = 100 % [100 % ; 100 %] | 0.92 [0.78 ; 1.00] | 0.01 [0.00 ; 0.02] | 0.02 [0.00 ; 0.08] | — |

- v4 − v1, taux de fausses alertes (bootstrap apparié, IC 95 %) : [+5 ; +28] points
- v4 − v1, embrasements annoncés (bootstrap apparié, IC 95 %) : [+0 ; +0] points
- v4 seuil par essai − v1, taux de fausses alertes (bootstrap apparié, IC 95 %) : [-55 ; -14] points
- v4 seuil par essai − v1, embrasements annoncés (bootstrap apparié, IC 95 %) : [+0 ; +0] points

## maisons 2016 et 2019 (négatifs)

| Modèle | Embrasements annoncés | Avance médiane (s) | Avance P10 (s) | Fausses alertes (locaux calmes) | Rappel par pas | Précision par pas | PR-AUC | Brier |
|---|---|---|---|---|---|---|---|---|
| v4 (réel seul) | 0 / 0 | — | — | 190 / 355 = 54 % [34 % ; 72 %] | — | 0.00 [0.00 ; 0.00] | — | 0.000 [0.000 ; 0.000] |
| v4, seuil par essai (secondaire) | 0 / 0 | — | — | 1 / 355 = 0 % [0 % ; 1 %] | — | 0.00 [0.00 ; 0.00] | — | 0.000 [0.000 ; 0.000] |
| v1 (simulateur, livrée) | 0 / 0 | — | — | 29 / 355 = 8 % [5 % ; 12 %] | — | 0.00 [0.00 ; 0.00] | — | 0.007 [0.004 ; 0.011] |
| v3 (simulateur, non livrée) | 0 / 0 | — | — | 12 / 355 = 3 % [1 % ; 6 %] | — | 0.00 [0.00 ; 0.00] | — | 0.002 [0.001 ; 0.003] |
| règle simple (pente + pannes) | 0 / 0 | — | — | 120 / 355 = 34 % [23 % ; 43 %] | — | 0.00 [0.00 ; 0.00] | — | — |

- v4 − v1, taux de fausses alertes (bootstrap apparié, IC 95 %) : [+25 ; +63] points
- v4 seuil par essai − v1, taux de fausses alertes (bootstrap apparié, IC 95 %) : [-12 ; -5] points

## Comparaison à détection égale (seuil oracle, pas un point de fonctionnement)

Pour chaque modèle, le seuil le plus haut qui annonce encore les 11 embrasements, choisi sur les étiquettes du test : il compare la capacité des modèles à séparer les locaux, à règle égale, mais n'est pas utilisable tel quel.

| Modèle | toutes les données réelles | FSRI 2018 (un local) |
|---|---|---|
| v4 (réel seul) | 35 / 464 fausses alertes | 35 / 109 fausses alertes |
| v1 (simulateur, livrée) | 118 / 464 fausses alertes | 92 / 109 fausses alertes |
| v3 (simulateur, non livrée) | 93 / 464 fausses alertes | 76 / 109 fausses alertes |
| règle simple (pente + pannes) | 116 / 464 fausses alertes | 83 / 109 fausses alertes |

## Groupes et seuils

| Groupe | Configurations | Embrasements | Seuil v4 P30 | Seuil v4 P60 | Seuils v4 par essai P30 / P60 (secondaire) | Seuil règle |
|---|---|---|---|---|---|---|
| 0 | 15 | 3 | 0.0006 | 0.0091 | 0.0369 / 0.1700 | 1.201 |
| 1 | 16 | 3 | 0.0007 | 0.0026 | 0.0065 / 0.0756 | 0.607 |
| 2 | 16 | 2 | 0.0000 | 0.0000 | 0.0792 / 0.8091 | 0.607 |
| 3 | 18 | 3 | 0.0000 | 0.0000 | 0.1315 / 0.3782 | 1.202 |

v4 finale (toutes les données réelles) : seuils = médiane des groupes, P30 0.0003, P60 0.0013 ; seuils secondaires par essai P30 0.0581, P60 0.2741.

## Embrasements un par un (toutes données)

| Essai | v4 (réel seul) | v4, seuil par essai (secondaire) | v1 (simulateur, livrée) | v3 (simulateur, non livrée) | règle simple (pente + pannes) |
|---|---|---|---|---|---|
| Overstuffed_Open_Back_1 | 86 s | 86 s | 36 s | 26 s | 46 s |
| Overstuffed_Open_Back_2 | 104 s | 84 s | 44 s | 24 s | 104 s |
| Overstuffed_Open_Back_3 | 90 s | 70 s | 10 s | 20 s | 90 s |
| Overstuffed_Open_Center_1 | 222 s | 92 s | 32 s | manqué | 82 s |
| Overstuffed_Open_Corner_1 | 129 s | 109 s | 19 s | 39 s | 119 s |
| Overstuffed_Open_Corner_2 | 104 s | 94 s | 54 s | 24 s | 94 s |
| Overstuffed_Open_Corner_3 | 114 s | 94 s | 54 s | 44 s | 104 s |
| RedAccent_Open_Back_1 | 305 s | 135 s | 105 s | 85 s | 115 s |
| RedAccent_Open_Center_1 | 331 s | 151 s | 61 s | 111 s | 161 s |
| RedAccent_Open_Corner_1 | 296 s | 136 s | 116 s | 116 s | 156 s |
| RedAccent_Open_Corner_2 | 319 s | 169 s | 139 s | 109 s | 189 s |
