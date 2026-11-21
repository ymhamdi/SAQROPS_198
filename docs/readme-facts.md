# Faits du README et leurs sources

Chaque chiffre ou affirmation du README de `main` figure ici, avec sa valeur et la source qui fait foi : un fichier et
sa clé, ou une commande lancée. Les fichiers de résultats et les tests font foi, pas les autres documents. Relevés le
21 novembre 2026 vers 20 h 30 sur `docs/readme-main` (créée depuis `origin/feat/digital-twin`, `e9b7cbc`), puis mis à
jour vers 21 h après la fusion de `4a0323d` (démonstration automatique `?demo=1`).

## Tests et architecture

| Fait | Valeur | Source |
|---|---|---|
| Tests de l'application | **228** tests, 20 fichiers, tous verts | `cd app && npx vitest run` après la fusion de `4a0323d` → « Test Files 20 passed (20) · Tests 228 passed (228) » ; même résultat sur un clone neuf de `feat/digital-twin` (`npm ci && npm test`) |
| Tests Python | **4** tests, verts | `ml/.venv/Scripts/python.exe -m pytest ml -q` → « 4 passed » (`ml/` inchangé par `4a0323d`) |
| Total des tests | **232** | 228 + 4, les deux commandes ci-dessus |
| Démarrage rapide | clone, `git checkout feat/digital-twin`, `npm ci`, `npm test`, `npm run typecheck`, `npm run build` : tout passe | lancé sur un clone neuf, `4a0323d`, 21/11 vers 21 h → « QUICKSTART-OK » ; `npm run dev` : serveur utilisé pour les captures ; `npm run preview` : non relancé |
| Hors-ligne | aucune requête hors de `localhost` pour le PC, la tablette, le HUD et le jumeau ; police Barlow chargée | Edge piloté par Playwright, toute requête hors `localhost` bloquée et listée → « none » |
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
| Porte fermée à T+214 s, juste après le NO-GO | 15 s plus tard (T+229 s) : score P60 de la cabine 0,50 → 0,01 ; délai estimé 107 → 219 s ; verdict toujours NO-GO | le test ferme la porte au verrouillage puis avance de 15 s ; il imprime alors « t=229 door closed: booth P60 0.50 → 0.01, estimate 107 → 219 s » (assertions R6) |
| Porte fermée dès le NO-GO (autre test) | à T+225 s : 0,64 porte ouverte contre 0,02 porte fermée ; pas d'embrasement de la cabine en 420 s | « booth prediction at t=225 … », « booth flashover: door open 286, door closed null » |
| Sortie du binôme | T+259 s, **272 bar** (sifflet à 55 bar) | « t=259 team out at 272 bar » |
| Ré-engagement (décision COS) | vers le TGBT, **GO**, sortie prévue à 242 bar | « t=259 re-engaged to the switchboard: GO, exit planned at 242 bar » |

## Démonstration automatique (`?demo=1`, SIMULATED)

| Fait | Valeur | Source |
|---|---|---|
| Durée | environ 41 s de temps réel ; 42 s mesurées dans le navigateur | `npx vitest run src/demo/demo.test.ts` → « done at t=438, about 41 s of real time » ; Edge : légende « Fin de la démonstration » après 42 s |
| Légendes | une par étape, « Étape n/6 » | `app/src/demo/captions.ts` ; vu dans le navigateur |
| Pause | bouton **Pause** du PC pendant la démo : l'horloge s'arrête | Edge : T+1:20 → T+1:20 après 2,5 s |
| Espace, R | seulement dans une fenêtre d'équipage `?view=hud|tablet|twin&demo=1` : Espace met en pause, R recommence | `app/src/demo/DemoBar.tsx` ; Edge, tablette : T+1:34 → T+1:34, puis R → T+0:28 ; sur le PC, Espace ne met pas en pause |
| Réinitialiser pendant la démo | la démo repart ; il faut d'abord « Arrêter la démo » | Edge : après « Réinitialiser » le bouton affiche encore « Arrêter la démo » |
| Objectif retiré | dans l'interface, les cases d'objectif sont désactivées une fois le binôme sorti : on retire l'objectif pendant l'évacuation | `app/src/panels/Pc.tsx` (`disabled={done || s.team.mode === 'out'}`) ; capture : ré-engagement → GO, 242 bar |

## Captures du README (SIMULATED, `assets/readme/`)

Prises le 21/11 vers 21 h sur le code fusionné (`4a0323d`), serveur `npm run dev`, Edge piloté par playwright-core 1.49.1
(installé hors du dépôt). PC, tablette, HUD et jumeau sont des pages d'un même contexte de navigateur, donc reliés par la
même liaison que dans la démo. Graine 42, ×20, ×1 autour du NO-GO pour l'arrêter à la seconde. Chaque valeur ci-dessous
est lue sur l'image.

| Image | Moment | Valeurs affichées |
|---|---|---|
| `hero-no-go.jpg`, `screen-pc.jpg`, `screen-tablet.jpg`, `screen-hud.jpg` | T+3:34, NO-GO | « Embrasement prévu Cabine de peinture sous 60 s » ; pression 279 bar ; à la sortie 272 bar ; marge PNR 214 bar ; sortie la plus proche 44 s ; sortie Ouest à 24 m |
| `screen-twin.jpg` | T+3:34 | cabine : P(≤ 60 s) 50 %, délai estimé 105 s ; « L'IA a aggravé le verdict » |
| `go-route.jpg` | T+1:56, GO | sortie prévue à 239 bar ; marge minimale 183 bar |
| `drone-plume.jpg` | T+1:24 | drone en vol ; marge PNR batterie 74 % ; « Zone interdite drone (panache) » |
| `door-open.jpg` / `door-closed.jpg` | T+3:34 / T+3:49 (porte fermée à T+3:34) | « IA : embrasement sous 60 s, délai ≈ 105 s » / « IA : pas d'alerte (P60 1 %) » ; verdict NO-GO sur les deux |
| `truth-twin.jpg` | T+4:52, porte laissée ouverte | « Embrasement : T+4:46 » ; « Avance de l'IA : 72 s avant l'embrasement » |
| `reengage-tablet.jpg` | T+4:23, après « Ré-engager (décision COS) » | GO ; « Ré-engagement : décision COS » ; Coupure électrique — TGBT ; à la sortie 242 bar |
| `screen-card.jpg` | même moment, média `print` | « GO · Décision : COS » ; mission TGBT ; consignes sourcées (ERG 2024, OSHA, NFPA 70E, EN 137) |

## Schémas faits main

| Schéma | Valeurs | Source |
|---|---|---|
| `diagram-air-pnr.svg` | 279 bar ; sifflet 55 bar ; marge PNR 214 bar ; sortie à ×1,5 ≈ 10 bar | valeurs de `screen-pc.jpg` ; formule de `checkPnr` (`app/src/stats/air.ts`) : marge = pression − sifflet − 1,5 × air jusqu'à la sortie la plus proche ; 279 − 55 − 214 = 10 ; contrôle : 1,5 × 44 s × 60 L/min ÷ 6,8 L = 9,7 bar (`ari.consumptionExitLpm`, `ari.cylinderL`) |
| `diagram-fsri.svg` | 120 carrés : 11 embrasements annoncés, 92 fausses alertes, 17 locaux calmes sans alerte | généré depuis `ml/report/fsri-planB/report.json` `scenario` |
| `fsri-engine-open.png`, `fsri-engine-closed.png` | copies de `ml/report/fsri_physics/500kW_Open_Center_1.png` et `500kW_Closed_Center_1.png` | `ml/fsri_physics_report.py` |

## À ne pas reprendre (sans source ou contredit)

| Affirmation | Où | Pourquoi |
|---|---|---|
| « plus de 170 tests », puis « plus de 220 tests » | `README.md` de `feat/digital-twin` avant et après `4a0323d` | 232 en réalité (228 + 4) |
| « Décocher l'objectif « Victime – cabine » puis Ré-engager » une fois le binôme sorti | `README.md` de `feat/digital-twin`, « Rejouer la démonstration à la main » | impossible dans l'interface : la case est désactivée une fois le binôme sorti |
| « environ 45 secondes » pour la démo automatique | idem | le test donne 41 s, le navigateur 42 s : le README dit « en une minute » |
| « 161 tests automatiques » | `CONTEXTE.md` | idem |
| « l'embrasement recule de 286 s à 597 s » | `ml/MODEL_REPORT.md` §5.5 | aucun test ni fichier ne produit 597 s ; le test donne « door closed null » sur 420 s |
| Test de R5 : `app/src/danger/rules.test.ts` | `CLAUDE.md` §3 | fichier absent ; le test est dans `app/src/sim/sim.test.ts` |
| Notebook `ml/kaggle/`, `ml/prepare.py`, entraînement sur NIST mds2-2258 | `CLAUDE.md` §5, §6, §8 | absents ; NIST non téléchargé |
| Courbes NIST FCD (`data/nist/*.csv`, OBSERVED) | `CLAUDE.md` §4, §5 | dossier vide, aucune courbe |
| Toute statistique tunisienne d'incendies | — | aucune source citable rassemblée : elle n'apparaît pas |
