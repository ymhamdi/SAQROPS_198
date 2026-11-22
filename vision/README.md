# Module vision — détecter le feu depuis le drone (prototype séparé)

Second prototype de l'équipe SAQROPS. Il part du flux caméra RGB du drone (ou d'une caméra fixe) et enchaîne :

1. **Détection** des flammes (`fire`) et de la fumée (`smoke`) par un YOLOv8s affiné sur le jeu public D-Fire ;
2. **Filtre temporel** : alerte confirmée si la classe est vue sur au moins 4 des 8 dernières images (seuils : feu 0,15, fumée 0,25) ;
3. **Localisation** de la détection sur une carte en grille (5 m par case), à partir d'une télémétrie de drone **simulée** ;
4. **Propagation** : automate stochastique, 100 simulations, vent faible (10 km/h) et sirocco (40 km/h), horizons de 10 à 45 min ;
5. **Évacuation** et accès des camions (Dijkstra sur une carte de coût qui pénalise le risque et la fumée), puis une page web de démonstration.

Rapport complet : [RAPPORT_TECHNIQUE.pdf](RAPPORT_TECHNIQUE.pdf).

> Ce module **n'est pas branché à l'application PNR** et ne nourrit pas son verdict. C'est un démonstrateur expérimental, ni
> certifié ni validé en conditions réelles. Les décisions restent à la Protection civile : Décision : COS.

## Résultats rapportés par l'équipe

| Mesure | Valeur |
|---|---|
| Précision / rappel / mAP@0,5 (jeu de test D-Fire) | 0,777 / 0,707 / 0,781 |
| Images sans feu qui déclenchent une détection (par image, **avant** le filtre 4 sur 8) | ≈ 2,2 % |
| Vitesse (GPU NVIDIA RTX 4050, 640 px) | ≈ 89 images/s |
| Au moins un bâtiment atteint à 45 min (100 simulations, SIMULATED) | 8–13 % sous vent faible, 70–99 % sous sirocco |

Ces chiffres viennent du rapport technique ; ils ne sont pas reproductibles depuis ce dépôt seul (poids et données absents, voir plus bas).

## Les scripts, dans l'ordre

| Étape | Script | Ce qu'il fait |
|---|---|---|
| Carte | `site_demo.py` | Site fictif 600 m × 600 m (120 × 120 cases de 5 m) → `carte/site_demo.json` |
| Données | `data.yaml`, `check_classes.py` | Description de D-Fire (0 = smoke, 1 = fire) ; contrôle visuel des classes |
| Entraînement | `train_test.py`, `train.py` | Essai court (5 % des images, 1 époque), puis 30 époques depuis `yolov8s.pt` |
| Évaluation | `evaluation_finale.py`, `seuils.py`, `test_sans_feu.py` | Métriques, précision / rappel par seuil, fausses alertes sur 1 000 images sans feu, vitesse |
| Vidéo | `predict_video_csv.py`, `alerte_simple.py`, `trous.py` | Détections image par image (CSV), alertes lissées, plages sans détection |
| Localisation | `localisation.py` | Pixel → position sur la carte (caméra verticale, terrain plat), incertitude |
| Propagation | `propagation.py`, `validation.py` | Simulations Monte Carlo ; tests de direction du vent et de sensibilité aux brandons |
| Évacuation | `evacuation.py`, `recommandation.py` | Itinéraires vers les rassemblements, accès camions, rassemblement le plus sûr |
| Démo | `generer_page.py`, `pipeline_demo.py` | Page `page_demo.html` ; chaîne complète vidéo → détection → localisation → simulation |
| Site réel (exploration) | `verif_osm.py`, `verifier_batiments.py` | Données OpenStreetMap d'un îlot industriel (Mghira) et contrôle des bâtiments |

## Lancer

```bash
python -m venv fire_env && fire_env\Scripts\activate
pip install -r requirements.txt
python site_demo.py && python propagation.py && python evacuation.py && python generer_page.py
```

Les chemins sont **écrits en dur** (`C:/Fire_project/...`) en haut de chaque script : à adapter. La partie simulation
(`site_demo.py` → `generer_page.py`) tourne sans GPU ni poids. La détection a besoin d'un GPU CUDA (`device=0`).

## Absent du dépôt

- Les poids `runs/dfire_v1/weights/best.pt` (22,5 Mo), le jeu D-Fire, `yolov8s.pt` et les vidéos de test (exclus par `.gitignore`).
- `site_reel_mghira.py` et `visualiser_carte.py`, cités dans le rapport technique, n'ont pas été fournis.

## Limites

- D-Fire est fait surtout de photos prises **au sol** : les performances vues depuis un drone restent à mesurer.
- Le taux de 2,2 % est mesuré par image ; la baisse attendue avec le filtre 4 sur 8 suppose des erreurs indépendantes
  d'une image à l'autre, ce qui n'est pas vrai dans une vidéo.
- La télémétrie du drone (position, altitude, cap, champ de vue) et ses erreurs sont des valeurs de départ, non calibrées.
- Propagation : paramètres non calibrés, un seul départ de feu, vent constant, terrain plat, pas d'intervention des secours.
  Seule la comparaison entre scénarios est défendable.
- Évacuation : tout le monde part à l'instant affiché, sans délai de réaction, mobilité réduite ni congestion.

## Sources et licences

- D-Fire, jeu de données d'images de feu et de fumée : <https://github.com/gaiasd/DFireDataset>.
- Ultralytics YOLOv8 (licence AGPL-3.0), utilisé comme dépendance, non inclus dans le dépôt.
- OpenStreetMap, © contributeurs OpenStreetMap, licence ODbL, via l'API Overpass.
