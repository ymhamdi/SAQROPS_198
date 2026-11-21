# Crédits et usage de l'IA

PNR · Point de Non-Retour, challenge Aero-Entrepreneur (Tunisian Aeroday × Protection civile × INJAZ).

Ce projet n'est approuvé ni par la Protection civile, ni par Tunisian Aeroday, ni par INJAZ, ni par la NASA. Il n'utilise aucun de leurs logos. Ces noms n'apparaissent que pour situer le challenge ou citer une source.

## Origine du code : Martian Map

Ce dépôt part d'un instantané de **Martian Map** (NASA Space Apps Challenge 2026, *Interplanetary Survival Guide: Martian Map*, instantané `5ea4f2e`), importé comme base au commit `1e91a7d`. Il en reste :

- le moteur de route **A\*** et le champ de temps de sortie (Dijkstra sur le graphe inversé), qui servent ici à calculer l'itinéraire et le temps de sortie d'un binôme ;
- la logique de **point de non-retour** : la réserve d'O₂ d'une sortie extra-véhiculaire devient l'air de l'ARI, avec le même retour 1,5 fois plus lent que prévu ;
- la liaison en direct entre le poste de pilotage et les écrans de l'équipe, la structure de l'application et les polices.

Le code, les cartes, les données (NASA, USGS) et le copilote vocal propres à Mars ont été retirés ; il reste quelques vestiges dans les feuilles de style, dans le favicon et dans les notes de conception du HUD (`docs/`). Le moteur feu, les détecteurs, le modèle d'IA, le drone, les écrans du PC du COS, de la tablette, du HUD et de la fiche réflexe, et les consignes ont été ajoutés pour ce challenge (voir l'historique git).

## Usage de l'IA

Nous avons utilisé **Claude Code** (assistant de programmation d'Anthropic) pendant tout le projet :

- **Code** : l'essentiel de l'application (`app/`), des scripts de données et d'entraînement (`ml/`, `scripts/`) et de leurs tests a été écrit avec l'assistant, à partir des instructions du projet (`CLAUDE.md`).
- **Documentation** : ce fichier, le README, le rapport du modèle (`ml/MODEL_REPORT.md`) et les textes de l'application ont été rédigés avec l'assistant.
- **Consignes de la fiche réflexe** (`data/consignes.json`) : rédigées avec l'assistant, sous forme de paraphrases de références publiques citées une à une. **Elles doivent être relues ligne par ligne contre leurs sources et validées par la Protection civile avant tout usage réel.** Elles ne sont jamais produites à l'exécution : l'application n'appelle aucun modèle de langage.
- **Modèle prédictif** : le modèle d'embrasement est un XGBoost, pas un modèle de langage. Il est entraîné par `ml/train.py` sur des scénarios de notre moteur feu ; la méthode, les données et les limites sont dans `ml/MODEL_REPORT.md`.
- **Cadrage** : le produit, les règles de sécurité R1 à R8, les hypothèses chiffrées et leurs sources sont écrits dans `CLAUDE.md`, `PRODUCT.md` et `data/config.json` ; chaque règle de sécurité est vérifiée par un test automatique.

**Aucune image ni vidéo produite par un modèle de génération d'images ou de vidéos n'est utilisée dans le dépôt** : il ne contient ni photo ni illustration, seulement du code, des données, des polices et le favicon, un SVG de Martian Map écrit avec l'assistant comme le reste du code. Si la vidéo de démonstration utilise des images, une voix ou des séquences générées par IA, elles seront signalées comme telles.

## Données

| Donnée | Crédit | Origine | Usage | Statut |
|---|---|---|---|---|
| Essais de feu en compartiment *fsri-compartments-2018* | UL Fire Safety Research Institute (UL FSRI) | <https://github.com/ulfsri/fsri-compartments-2018> | Validation du modèle et du moteur feu seulement. Téléchargés à la demande par `ml/download.py`, non redistribués dans ce dépôt. | OBSERVED (signal des détecteurs : DERIVED) |
| NIST P-Flash, jeux mds2-2258 et mds2-2479 | NIST ; Tam et al. (2021) ; licence NIST <https://www.nist.gov/open/license> | <https://data.nist.gov/od/id/mds2-2258> et <https://data.nist.gov/pdr/lps/ark:/88434/mds2-2479> | Données d'entraînement prévues, **non utilisées à ce jour** (serveur injoignable le 21 novembre 2026). Le modèle livré est entraîné sur notre moteur feu. | MODELED (simulations CFAST) |
| Vent extérieur au site | Open-Meteo.com, licence CC BY 4.0 | <https://open-meteo.com> | Direction et vitesse du vent pour la zone d'exclusion du drone, mises en cache dans `data/weather/open-meteo.json` (le vent est une analyse de modèle météo, pas une mesure sur site) | DERIVED |
| Consignes réflexes | ERG 2024 (guides 115, 121, 127, 128, 138, 147) ; NFPA 70E (2024) ; OSHA 29 CFR 1910.134(g)(4) ; EN 137:2006 | Références publiques, citées une par une dans `data/consignes.json` | Paraphrases imprimées sur la fiche réflexe, à valider par la Protection civile | MODELED |
| Caractéristiques du drone | Fiches techniques constructeur d'une classe de drones thermiques industriels (2022). Aucune marque n'est nommée. | `data/config.json` | Autonomie, vitesse, vent maximal, résolution thermique | MODELED |
| Corrélations de feu et de détecteurs, normes | SFPE Handbook of Fire Protection Engineering ; NFPA 72 et NFPA 92 ; McCaffrey, Quintiere et Harkleroad (1981) ; Kawagoe (1958) ; Alpert (1972) ; Heskestad ; Karlsson et Quintiere (2000) ; Thomas (1981) ; Peacock et al., CFAST (NIST TN 1889v1) ; EN 13501-2 | Liste détaillée avec les références : `data/SOURCES.md` | Moteur feu et détecteurs | MODELED |

Le plan de l'atelier (`data/site/atelier.json`) est dessiné par l'équipe : c'est un **site fictif**, sans entreprise ni plan réels. Ses coordonnées servent uniquement à récupérer le vent.

**Contenu simulé.** Le feu, les relevés des détecteurs, les prédictions de l'IA pendant la démonstration, l'image thermique du drone et la liaison entre fenêtres sont `SIMULATED` ; la position du binôme est `MOCK`. L'application les étiquette ainsi partout (règle R3).

## Méthodes et algorithmes

- **Prévision de l'embrasement** : approche du NIST P-Flash (Tam et al.), avec un modèle XGBoost : Chen et Guestrin (2016), *XGBoost: A Scalable Tree Boosting System*, KDD '16.
- **Route et temps de sortie** : A\* (Hart, Nilsson et Raphael, 1968) et algorithme de Dijkstra (1959). L'ordre des objectifs est cherché par séparation et évaluation exacte jusqu'à 9 points, puis par plus proche voisin et 2-opt (Croes, 1958).
- **Air de l'ARI** : alarme basse pression à 55 ± 5 bar, norme EN 137:2006. La bouteille, la consommation, les vitesses de progression et le retour ×1,5 sont des **hypothèses d'équipe à valider** avec la Protection civile (`data/config.json`).
- **Toutes les autres valeurs** (seuils, coûts de route, zone d'exclusion du drone, plages de génération des données) sont nos hypothèses : l'application les étiquette `MODELED`, et chacune a sa source ou sa raison dans `data/config.json`.

## Logiciels

| Logiciel | Licence | Usage |
|---|---|---|
| React, React DOM | MIT | Interface |
| Vite, @vitejs/plugin-react | MIT | Outil de build |
| TypeScript | Apache-2.0 | Langage |
| Vitest | MIT | Tests de l'application |
| XGBoost | Apache-2.0 | Entraînement des modèles |
| NumPy, pandas, scikit-learn | BSD-3-Clause | Données et évaluation |
| Matplotlib | licence Matplotlib (de type BSD) | Courbes des rapports |
| pyarrow, openpyxl | Apache-2.0 ; MIT | Lecture des fichiers de données |
| pytest | MIT | Tests Python |
| Python, Node.js | licence PSF ; MIT | Exécution |

## Polices et icônes

- **Barlow** et **Barlow Semi Condensed**, par Jeremy Tribby, licence SIL Open Font 1.1, depuis Google Fonts (<https://fonts.google.com/specimen/Barlow>). Hébergées dans `app/public/fonts/`, pour que la démonstration fonctionne hors-ligne.
- Aucune bibliothèque d'icônes ni image tierce n'est utilisée ; le favicon (`app/public/favicon.svg`) est celui de Martian Map.
