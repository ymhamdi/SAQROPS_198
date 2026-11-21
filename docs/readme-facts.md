# Faits du README et leurs sources

Chaque chiffre ou affirmation du README de `main` figure ici, avec sa valeur et la source qui fait foi : un fichier et
sa clé, ou une commande lancée. Les fichiers de résultats et les tests font foi, pas les autres documents. Relevés le
21 novembre 2026 vers 20 h 30 sur `docs/readme-main` (créée depuis `origin/feat/digital-twin`, `e9b7cbc`).

## Tests et architecture

| Fait | Valeur | Source |
|---|---|---|
| Tests de l'application | **210** tests, 19 fichiers, tous verts | `cd app && npm ci && npx vitest run` → « Test Files 19 passed (19) · Tests 210 passed (210) » |
| Tests Python | **4** tests, verts | `ml/.venv/Scripts/python.exe -m pytest ml -q` → « 4 passed » |
| Total des tests | **214** | 210 + 4, les deux commandes ci-dessus |
| Règles de sécurité | **8** (R1 à R8), chacune avec un test | `CLAUDE.md` §3 ; fichiers listés ci-dessous |
| R1 | `app/src/danger/merge.test.ts` | `git ls-files 'app/src/**/*.test.ts'` |
| R2 | `app/src/stats/verdict.test.ts` | idem |
| R3 | `app/src/ui/labels.test.ts` | idem |
| R4 | `app/src/config.test.ts` | idem (le fichier existe ; il n'est pas listé par le motif `app/src/**/` car il est à la racine de `src/`) |
| R5 | `app/src/sim/sim.test.ts` (« R5 the verdict reads detectors only ») | idem ; `CLAUDE.md` cite à tort `app/src/danger/rules.test.ts`, absent |
| R6 | `app/src/stats/latch.test.ts` | idem |
| R7 | `app/src/drone/drone.test.ts` | idem |
| R8 | `app/src/ml/xgb.test.ts` | idem |
| Aucun serveur | dépendances d'exécution de l'application : `react`, `react-dom` (et `leaflet`, déclaré mais plus importé) ; simulation dans un Web Worker | `app/package.json` `dependencies` ; `grep -rl "from 'leaflet'" app/src` → rien ; `app/src/sim/worker.ts` |
| Hors-ligne | polices hébergées dans le dépôt, vent lu depuis un cache | `app/public/fonts/FONTS.md` ; `data/weather/open-meteo.json` |
| Node.js | 22.12 ou plus récent (24 utilisé) | README actuel ; `node --version` → v24.22.1 (pas de champ `engines` dans `app/package.json`) |

## Site de démonstration (MODELED)

| Fait | Valeur | Source |
|---|---|---|
| Bâtiment | 60 × 40 m, grille de 0,5 m | `data/site/atelier.json` `building` |
| Locaux | 6 (bureaux, TGBT, local Li-ion, stockage solvants, cabine de peinture, halle) | `data/site/atelier.json` `rooms` |
| Sorties | 3 | `data/site/atelier.json` `exits` |
| Détecteurs de chaleur | 15 | `data/site/atelier.json` `detectors` |
| Objectifs possibles | 3 | `data/site/atelier.json` `objectives` |
| Site fictif, aucune entreprise réelle | | `data/site/atelier.json` `source` |

## Hypothèses (MODELED, `data/config.json` → `hypotheses`)

| Fait | Valeur | Clé |
|---|---|---|
| Bouteille ARI | 6,8 L à 300 bar | `ari.cylinderL`, `ari.startBar` |
| Sifflet basse pression | 55 bar (EN 137) | `ari.whistleBar` |
| Retour plus lent que prévu | ×1,5 | `ari.returnFactor` |
| Panne d'un détecteur | au-delà de 150 °C | `detectors.failureC` |
| Embrasement | couche chaude à 600 °C | `fire.flashoverC` |
| Drone : autonomie, vitesse | 41 min, 8 m/s | `drone.enduranceMin`, `drone.cruiseMs` |
| Drone : vent maximal | 12 m/s | `drone.maxWindMs` |
| Drone : réserve de batterie | 25 % | `drone.batteryReservePct` |
| Drone : altitude | 30 m | `drone.altitudeM` |

## Données réelles

| Fait | Valeur | Source | Étiquette |
|---|---|---|---|
| Vent au site | 1,62 m/s venant de 248°, analyse du 21/11/2026 14 h 45 | `data/weather/open-meteo.json` `windSpeedMs`, `windFromDeg`, `time` | DERIVED |
| Essais réels UL FSRI | **120** expériences, dont **11** atteignent 600 °C | `python ml/prepare_fsri.py` → « FSRI: 120 runs, 11 reach 600 °C » ; `ml/report/fsri-planB/report.json` `scenario.flashovers` = 11, `scenario.quietRooms` = 109 | OBSERVED |
| NIST P-Flash | prévu, **non utilisé** (serveur injoignable le 21/11) | `CREDITS.md` ; `ml/MODEL_REPORT.md` §3.1 | MODELED |

## Modèle IA livré (v1, `ml/model/metrics.json`)

| Fait | Valeur | Clé |
|---|---|---|
| Données d'entraînement | 5 000 scénarios de notre moteur feu, 364 990 exemples | `trainedOn` ; `rows` (253 918 + 59 207 + 51 865) |
| Variables, modèles | 13 variables, 3 modèles XGBoost (≤ 30 s, ≤ 60 s, délai) | `ml/model/contract.json` `features`, `models` |
| Arbres | 263, 256, 375 | `trees` |
| Seuils (rappel ≥ 0,95 en validation) | 0,41 (≤ 30 s), 0,49 (≤ 60 s) | `thresholds` |
| Test simulé, ≤ 60 s : rappel, précision, PR-AUC | 0,946 · 0,517 · 0,761 | `test.p60` |
| Règle simple sur la pente, même objectif : PR-AUC | 0,315 | `test.baselineSlopeRule.p60.prAuc` |
| Test simulé, par local | 893 embrasements annoncés sur 905, avance médiane 94 s (P10 52 s) | `test.p60.leadTimes` (905 − 12 manqués) |
| Essais UL FSRI, v1 | **11 / 11** annoncés, avance médiane 54 s (P10 19 s), **mais 92 fausses alertes sur 109 locaux qui ne s'embrasent pas** ; PR-AUC par pas de temps 0,02 | `ml/report/fsri-planB/report.json` `scenario`, `p60.prAuc` |
| Essais UL FSRI, v3 (non livrée) | 10 / 11, avance médiane 42 s, 72 fausses alertes sur 109 ; PR-AUC 0,09 | `ml/MODEL_REPORT.md` §5.3 (chiffres du commit `db6afc4`) |

## Moteur feu face aux essais réels (`ml/report/fsri_physics/summary.json`)

| Fait | Valeur | Clé |
|---|---|---|
| Essais rejoués | 105 | `experiments` |
| Écart quadratique moyen, porte ouverte | 105 °C | `rmseOpenDoorC` (105,3) |
| Écart quadratique moyen, porte fermée | 110 °C | `rmseClosedDoorC` (110,0) |
| Pièce fermée : plafond du moteur | ≈ 185 °C, contre 264 à 465 °C mesurés | `groups[*].peak_predicted_c`, `peak_measured_c` (portes fermées) |

## Scénario de démonstration (SIMULATED, graine 42, modèle livré)

Source : `cd app && npx vitest run src/sim/demo.test.ts --reporter=verbose`, lignes imprimées par le test.

| Fait | Valeur | Ligne du test |
|---|---|---|
| Drone | décolle à T+60 s, boucle partielle autour du panache | « t=60 drone up (Boucle partielle… » |
| Engagement | T+100 s, **GO**, sortie prévue à 239 bar | « t=100 engaged GO, exit planned at 239 bar » |
| NO-GO | T+214 s, « Embrasement prévu Cabine de peinture sous 60 s » | « t=214 NO-GO: … » |
| Détecteurs de la cabine tous en panne | T+226 s, 12 s après l'alerte | « booth: first alert 214, detectors all failed 226, flashover 286 » |
| Embrasement réel de la cabine (porte ouverte) | T+286 s : **72 s d'avance** pour l'IA | idem |
| Porte fermée à T+229 s | P(≤ 60 s) de la cabine 0,50 → 0,01 ; délai estimé 107 → 219 s ; verdict toujours NO-GO | « t=229 door closed: booth P60 0.50 → 0.01, estimate 107 → 219 s » et assertions R6 |
| Porte fermée dès le NO-GO (autre test) | à T+225 s : 0,64 porte ouverte contre 0,02 porte fermée ; pas d'embrasement de la cabine en 420 s | « booth prediction at t=225 … », « booth flashover: door open 286, door closed null » |
| Sortie du binôme | T+259 s, **272 bar** (sifflet à 55 bar) | « t=259 team out at 272 bar » |
| Ré-engagement (décision COS) | vers le TGBT, **GO**, sortie prévue à 242 bar | « t=259 re-engaged to the switchboard: GO, exit planned at 242 bar » |

## À ne pas reprendre (sans source ou contredit)

| Affirmation | Où | Pourquoi |
|---|---|---|
| « plus de 170 tests » | `README.md` actuel | 214 en réalité (210 + 4) |
| « 161 tests automatiques » | `CONTEXTE.md` | idem |
| « l'embrasement recule de 286 s à 597 s » | `ml/MODEL_REPORT.md` §5.5 | aucun test ni fichier ne produit 597 s ; le test donne « door closed null » sur 420 s |
| Test de R5 : `app/src/danger/rules.test.ts` | `CLAUDE.md` §3 | fichier absent ; le test est dans `app/src/sim/sim.test.ts` |
| Notebook `ml/kaggle/`, `ml/prepare.py`, entraînement sur NIST mds2-2258 | `CLAUDE.md` §5, §6, §8 | absents ; NIST non téléchargé |
| Courbes NIST FCD (`data/nist/*.csv`, OBSERVED) | `CLAUDE.md` §4, §5 | dossier vide, aucune courbe |
| Toute statistique tunisienne d'incendies | — | aucune source citable rassemblée : elle n'apparaît pas |
