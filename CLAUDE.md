# CLAUDE.md — PNR · Point de Non-Retour

## 1. Produit
Aide à la décision pour la Protection civile tunisienne lors d'un incendie sur site industriel. Dit au chef de
binôme (tablette, HUD masque ARI) et au COS (PC), à chaque instant : l'engagement est-il tenable, par où sortir,
pourquoi. Le verdict est une aide ; la décision appartient au COS.
Un drone de reconnaissance simulé fait le tour du site depuis l'engin (élément aéronautique exigé par le jury).
Fork de Martian Map (crédité dans CREDITS.md) : même A*, même logique de point de non-retour, même liaison PC ↔ tablette.
Challenge Aero-Entrepreneur (Tunisian Aeroday × Protection civile × INJAZ). Gel 22/11 01:00. Livrables 22/11 09:00.

## 2. Le code sert deux livrables, rien d'autre
1. La vidéo de démo d'1 min (script §9). 2. ml/MODEL_REPORT.md. Tout le reste est hors scope.

## 3. Règles de sécurité — chacune a un test, ne jamais en casser une
- R1 L'IA ne peut que dégrader un verdict (GO → NO-GO), jamais l'inverse. → app/src/danger/merge.test.ts
- R2 Tout verdict affiché sur le PC, la tablette et la fiche porte « Décision : COS ». Le HUD n'affiche que des
  alertes courtes (icône + mot + couleur), sans ce texte, pour rester lisible en moins d'une seconde.
  → app/src/stats/verdict.test.ts
- R3 Tout nombre affiché porte son étiquette ; SIMULATED/MOCK ne ressemble jamais à OBSERVED. → app/src/ui/labels.test.ts
- R4 Toute hypothèse vit dans data/config.json avec source et statut. → app/src/config.test.ts
- R5 Le verdict ne lit jamais la vérité du simulateur ni l'image thermique de la toiture : seulement les détecteurs
  (bruités, en panne), l'IA et, par R9 seulement, les observations intérieures du drone. → app/src/sim/sim.test.ts,
  app/src/demo/demo.test.ts, app/src/scene/render.test.ts
- R6 Un NO-GO est verrouillé : aucun retour automatique au GO. Seul le COS peut ré-engager (bouton « Ré-engager
  (décision COS) » sur le PC, action journalisée et diffusée). → app/src/stats/latch.test.ts
- R7 Drone : retour à l'engin garanti avec la réserve batterie de config.json ; vol refusé si vent > limite ;
  jamais dans la zone d'exclusion du panache. → app/src/drone/drone.test.ts
- R8 Parité modèle : l'évaluateur TypeScript reproduit les prédictions Python à 1e-6 près sur ml/model/golden.csv,
  y compris avec des valeurs manquantes (détecteurs en panne). → app/src/ml/xgb.test.ts
- R9 Une observation du drone d'intérieur ne peut qu'aggraver, comme l'IA (R1) : le coût qu'elle met sur un local ne
  descend jamais sous celui des détecteurs et de l'IA seuls, elle ne rend jamais un local « sûr ». Une absence
  d'observation n'est jamais une preuve de sécurité : un local non visité reste INCONNU, avec un coût d'incertitude
  (config.json), jamais un coût nul. Le drone n'ouvre jamais une porte. → app/src/knowledge/known.test.ts,
  app/src/drone/indoor.test.ts
- R10 Chaque observation porte une heure de prise de vue, une position, une confiance et une source ; elle vieillit
  (sa confiance décroît selon config.json) et, expirée, le local repasse à INCONNU. Dans une zone morte radio, elle
  n'arrive qu'au retour de la liaison : heure de prise de vue et heure de réception sont affichées.
  → app/src/knowledge/known.test.ts, app/src/drone/indoor.test.ts
- R11 La répétition ne lit jamais la vérité du simulateur : elle part de ce que PNR sait (détecteurs, IA, observations du
  drone) et des hypothèses de config.json. Modifier la vérité ne change aucun résultat. → app/src/rehearsal/engine.test.ts,
  app/src/rehearsal/view.test.ts, app/src/demo/demo.test.ts
- R12 Tout ce qui vient de la répétition porte « RÉPÉTITION — SIMULATION », dans un cadre et une couleur distincts du
  direct (violet, pointillé). La répétition n'apparaît jamais sur le HUD en direct. Le plan ne s'applique qu'après
  « Valider le plan (décision COS) » ; « Engager sans répétition » reste toujours possible.
  → app/src/rehearsal/plan.test.ts, app/src/rehearsal/view.test.ts
- R13 Le matériel USB (drone ESP32, HUD binôme STM32) ne peut qu'aggraver, comme l'IA (R1) et le drone d'intérieur (R9) : une
  lecture du drone au-dessus du seuil rend le local critique et le verdict NO-GO ; un MAYDAY force le NO-GO et rappelle
  l'équipe ; la pression de la bouteille alimente le PNR si elle est plus basse que celle du modèle. Une lecture qui baisse, un
  capteur silencieux, un paquet manquant, une bouteille plus pleine que le modèle ne rendent jamais un local sûr et ne
  ramènent jamais le verdict à GO : seul le COS efface (« Ré-engager (Décision : COS) », journalisé, qui envoie GO au HUD).
  Un rejeu est étiqueté REPLAY sous une bannière qui ne dit jamais « en direct » ; « REJEU d'une mesure réelle » est réservé
  aux fichiers enregistrés par l'application depuis l'USB (la séquence intégrée, écrite à la main, dit qu'elle n'est pas une
  mesure). → app/src/hardware/hardwareSim.test.ts, ingest.test.ts, replay.test.ts, pipeline.test.ts, firmware.test.ts

Copilote vocal de la tablette (app/src/copilot, server/) : le LLM comprend la question, PNR fournit la réponse.
Tests : app/src/copilot/guardrails.test.ts (C1–C8), app/src/copilot/copilot.test.ts, server/tests.
- C1 Lecture seule : il lit le snapshot que la tablette reçoit, data/consignes.json et data/config.json ; jamais
  rooms[].truth, jamais une action (pas d'import de sim/actions, sim/sim, sim/client). Modifier la vérité ne change
  aucune réponse.
- C2 Garde-fou des chiffres : une reformulation du LLM est rejetée (le gabarit est dit à la place) si elle contient un
  nombre absent du gabarit, un nombre en lettres (deux… mille, demi, quart, moitié ; « un/une » seulement devant une unité :
  « une minute » est rejeté, « un local » est permis), ou plus de copilot.maxWords mots.
- C3 Jamais oui ou non sur l'engagement : « Je peux entrer ? » → « Verdict actuel : X. Raisons : … Décision : COS. »
- C4 Les consignes sont lues telles qu'écrites dans data/consignes.json, avec leur source ; le LLM n'en écrit ni n'en
  reformule aucune.
- C5 Hors liste, incertain (confiance < copilot.minConfidence), lent (> copilot.understandTimeoutMs), invalide ou serveur
  absent : les règles répondent, sinon « Je ne réponds qu'aux questions de la liste. Demandez au COS. » et les boutons.
- C6 Les mots du Mayday sont reconnus par règles avant toute compréhension et n'atteignent jamais le LLM ; Mayday et
  bouton SOS → alerte rouge sur le PC (BroadcastChannel), journalisée, jusqu'à « Acquitter ». Le verdict ne change pas.
- C7 Chaque échange est journalisé sur le PC : question, intention, réponse, chemin (LLM / règles / bouton / SOS),
  latence. Chaque réponse porte « COPILOTE ».
- C8 Rien du copilote sur le HUD.

## 4. Étiquettes
OBSERVED mesure réelle (courbes NIST FCD, essais UL FSRI) · DERIVED calculé depuis des observations (vent Open-Meteo =
analyse de modèle météo, pas une mesure sur site) · MODELED nos hypothèses, corrélations et valeurs normatives (EN 137,
SFPE : hypothèse que l'équipement/le site est conforme), ET les données d'entraînement NIST P-Flash (simulations CFAST
du NIST, pas des mesures) · SIMULATED sortie du moteur feu pendant la démo, image thermique du drone, liaison
BroadcastChannel · MOCK getRealPosition() · REPLAY un enregistrement matériel rejoué (jamais « en direct »). Les valeurs
reçues en direct par l'USB sont OBSERVED ; la température × facteur du mode démo est MODELED, facteur affiché.
worstStatus : OBSERVED < DERIVED < MODELED < REPLAY < SIMULATED < MOCK ; une valeur
vaut son entrée la plus faible (la prédiction IA affichée en démo est donc SIMULATED).

## 5. Architecture
data/            config.json (toutes les hypothèses), SOURCES.md, consignes.json, site/atelier.json (MODELED),
                 nist/*.csv (OBSERVED), weather/open-meteo.json (cache)
app/src/site/    atelier.json → grille 0,5 m (120 × 80) : murs, portes, locaux, sorties. Les locaux à risque
                 d'embrasement (stockage solvants, cabine de peinture, local de charge Li-ion, bureaux) ont une taille
                 de pièce, proche du domaine d'entraînement NIST ; la halle principale n'est traitée que par la couche
                 de fumée et la température, pas par le modèle d'embrasement.
app/src/fire/    moteur feu par local, pas de 1 s. UN SEUL moteur pour l'app et le dataset. Fonctions pures,
                 paramètres injectés, imports avec extension .ts (exécutable par Node 24 sans build :
                 tsconfig avec erasableSyntaxOnly et allowImportingTsExtensions).
app/src/danger/  règles sur détecteurs + prédiction IA → raisons + multiplicateurs de coût A* ; fusion « dégrade seulement »
app/src/ml/      xgb.ts : évaluateur des arbres XGBoost exportés en JSON (gère NaN via default_left), dans le worker.
                 Aucune dépendance (pas d'onnxruntime-web). Fichiers : model-30s.json, model-60s.json, model-tff.json.
app/src/route/   A*, champ temps-de-sortie, re-itinéraire (hérités de Martian Map)
app/src/stats/   budget air ARI, PNR, GO/NO-GO avec raisons, verrou NO-GO, alertes live
app/src/drone/   trajet de reconnaissance, PNR batterie (même logique que le PNR air), zone d'exclusion panache,
                 image thermique de toiture (affichage PC seulement) ; indoor.ts = drone d'intérieur : A* sur la grille du
                 site, seulement par les portes déjà ouvertes (R9), jamais dans un local au-dessus de sa limite thermique,
                 PNR batterie, observations horodatées (R10) ; la planification lit ce que PNR sait, la détection lit la
                 vérité côté simulateur
app/src/knowledge/ « ce que PNR sait » : observation.ts (horodatage, vieillissement, expiration), known.ts (fusion détecteurs
                 + IA + drone, INCONNU, coûts qui n'aggravent que, raisons « drone »)
app/src/rehearsal/ répétition : engine.ts (fonctions pures sur KnownInput, sans vérité : plan, chronologie, heure de demi-tour,
                 sortie de repli, phases GO/NO-GO), input.ts (tranche du snapshot lue), compare.ts (plan ou réel),
                 RehearsalView/RehearsalMap (vue première personne du HUD alimentée par l'état projeté), RehearsalBanner (R12)
app/src/live/    BroadcastChannel PC ↔ tablette ↔ HUD (SIMULATED)
app/src/panels/  MissionControl = PC du COS · Tablet = tablette chef de binôme · Hud = HUD masque ARI ·
                 PrintCard = fiche réflexe binôme
app/src/scene/   vue synthétique du HUD (render.ts : lancer de rayons sur la grille du plan, fumée et chaleur d'après les
                 détecteurs seuls, R5 testé : la vérité du simulateur ne change aucun pixel) + Scene.tsx (chevrons de route,
                 repères) ; LiveMap.tsx = carte en direct de la tablette ; mission.ts = phases de la mission ; camera.ts
app/src/twin/    jumeau numérique (?view=twin, ouvert depuis le PC) : réalité simulée / ce que PNR en sait, chaîne de
                 décision en direct, courbes ; lit le snapshot diffusé par le PC, ne simule pas
app/src/demo/    démonstration automatique (?demo=1, ou ?view=hud|tablet|twin&demo=1) : script.ts joue le COS du scénario
                 §9 (feu, drone, engagement, porte fermée, ré-engagement) à partir du seul snapshot, sans la vérité du
                 simulateur (R5 testé) ; useDemo.ts l'applique au worker et règle la vitesse (allures dans config.json,
                 hypotheses.demo) ; DemoHost/DemoBar = fenêtre autonome et bandeau de légendes (sans mot de verdict : R2)
app/src/hardware/ liaison USB par Web Serial (Chrome, Edge ; aucun serveur) : protocol.ts (lignes JSON, jamais d'exception sur le
                 bruit), serialManager.ts (deux ports, débranchement et écriture en échec survécus, alertes au HUD
                 dédoublonnées), ingest.ts (ce qu'un paquet peut faire : seulement aggraver, R13), state.ts + sim (dangers
                 persistants, PNR sur la pression lue), gate.ts, replay.ts (enregistrement pnr-replay.json, rejeu déterministe,
                 séquence intégrée), useHardware.ts ; panneau panels/HardwarePanel.tsx
firmware/        drone_payload (ESP32 + GY-BMP280 + microswitch) et binome_hud (STM32 + potentiomètre + IR + LCD) : croquis
                 Arduino, README de câblage et de protocole ; non compilés ici, mais tenus à l'accord avec l'application par
                 app/src/hardware/firmware.test.ts
ml/              kaggle/pnr-flashover.ipynb (notebook exporté de Kaggle), train.py (même code), prepare.py (NIST xlsx →
                 Parquet), generate.ts (plan B : Node → CSV sur l'atelier), model/ (model-*.json, metrics.json,
                 golden.csv), MODEL_REPORT.md
Flux : le PC est maître. À chaque tick (1 s de temps simulé) le worker fait : moteur feu → lectures détecteurs (bruit,
pannes) → règles + IA → coûts → A* et champ de sortie → verdict (+ verrou R6). Re-itinéraire seulement si le verdict
change ou si le coût de l'itinéraire varie au-delà d'un seuil de config.json (pas de clignotement). Le PC diffuse ;
la tablette et le HUD affichent sans simuler.
Temps : le tick est du temps simulé, découplé de l'horloge murale ; vitesse de lecture ×N (config, ×10 pour la vidéo).
Vérité simulateur : calque PC désactivé par défaut, étiqueté SIMULATED, qui affiche l'embrasement réel et le délai
prédit vs réel (pour la vidéo et le rapport). Il ne nourrit jamais le verdict (R5).

## 6. Commandes
App (dans app/) : npm ci · npm run dev · npm test · npm run typecheck · npm run build
Entraînement : sur Kaggle (notebook ml/kaggle/pnr-flashover.ipynb). Les artefacts téléchargés vont dans ml/model/.
Python local (conversion, tests) : venv C:\dev\pnr-venv (hors repo, créé avec C:\Users\youss\miniconda3\python.exe,
absent du PATH) ; C:\dev\pnr-venv\Scripts\python.exe -m pip install -r ml/requirements.txt ;
python ml/prepare.py ; python ml/train.py (même code que le notebook)
Plan B dataset : node ml/generate.ts --n 5000 --seed 42 --out ml/data/scenarios.csv

## 7. Conventions
- Interface en français ; code, identifiants et commits en anglais (feat:, fix:, test:, docs:, chore:).
- Aucune nouvelle librairie UI. Décision du 21/11 (EN PAUSE, rien de construit) : remplacer le monde visuel du PC du COS (« salle
  opérationnelle sombre », direction choisie : SITAC, via le skill impeccable). Tablette, HUD et fiche suivent.
- Pas de nombre magique dans app/src : tout passe par config.ts, qui lit data/config.json.
- Chaque corrélation est citée en commentaire (auteur, année, SFPE Handbook / NIST) ET dans data/SOURCES.md.
- Consignes : uniquement dans data/consignes.json, chacune avec une source et « à valider par la Protection civile ».
  Jamais générées par un LLM.
- Aucune entreprise réelle nommée. LLM local seulement dans le copilote de la tablette, pour comprendre la question
  et reformuler sous garde-fou : jamais de chiffre, jamais de consigne, jamais d'ordre, jamais sur le chemin du Mayday
  (C1–C8). Pas de 3D. Un seul niveau. Pas d'auth, pas de base de données.
- Le repo est privé (décision du 22/11, à garder tel quel) mais doit rester publiable : jamais de secret commité.

## 8. Méthode
Jalons :
- 15:30 contrat du modèle figé : liste des features, format des fichiers model-*.json, modèle factice qui respecte
  ce format. L'app ne doit jamais attendre l'entraînement.
- 18:00 boucle complète (feu → détecteurs → XGBoost v1 entraîné sur NIST mds2-2258 → NO-GO → sortie).
- 20:00–22:00 drone (§12).
- 22:00 démo jouable (script §9 complet).
- 01:00 gel (ensuite : bugs, README FR, MODEL_REPORT, CREDITS, Vercel).
Après chaque jalon : test, typecheck et build verts, commit, résumé en 5 lignes (marche / ne marche pas).
Le repo vit dans C:\Users\youss\OneDrive\Desktop\AERODAY (choix de l'équipe, 21/11). OneDrive synchronise aussi
node_modules et .git : si git ou npm signalent un fichier verrouillé, suspendre la synchronisation OneDrive.
Python reste hors repo : venv C:\dev\pnr-venv, wheels C:\dev\wheels, données NIST brutes C:\dev\pnr-data.

## 9. Définition de « fini » = script de la vidéo
1. Le PC ouvre le site ; départ de feu dans le stockage solvants.
2. Le drone décolle de l'engin, fait le tour du bâtiment en évitant le panache, affiche son PNR batterie et l'image
   thermique de la toiture au PC.
2 bis. Le drone d'intérieur entre par la sortie Ouest, découvre le passage obstrué (un rack effondré absent du plan) et une
   porte fermée (au-delà : INCONNU). La répétition joue l'intervention en vue première personne, propose le contournement
   et l'heure de demi-tour, puis le COS valide le plan (« Valider le plan (décision COS) »). Sans répétition, « Engager
   sans répétition » reste possible et le scénario d'avant (app/src/sim/demo.test.ts) passe toujours. Sans plan, le
   binôme simulé rencontre le rack : il s'arrête devant (config `obstacle.contactDelayS`, au travail), le signale, PNR le
   ferme et il contourne ; avec le plan il ne le rencontre jamais (app/src/sim/obstacle.test.ts).
3. Un binôme est engagé vers un point de sauvetage (sur le plan validé) : itinéraire, air, PNR, GO.
4. Le feu grandit, des détecteurs tombent en panne, l'IA annonce l'embrasement du local voisin : NO-GO, nouvel
   itinéraire vers la sortie, alerte sur tablette et HUD, air à la sortie au-dessus du sifflet. Le calque « vérité
   simulateur » montre ensuite l'embrasement réel et le délai d'anticipation obtenu.
5. On referme une porte : le délai d'embrasement prédit remonte, le verdict reste NO-GO (R6) ; le PC voit
   « Ré-engager (décision COS) ».
6. Le PC retire un objectif ; la tablette reçoit le nouvel itinéraire en direct.
7. Impression de la fiche réflexe.

## 10. Correspondance Martian Map → PNR
grille terrain 2 m → plan d'usine 0,5 m · budget O₂ → air ARI (sifflet 55 bar, retour ×1,5) · PNR O₂ → PNR batterie
du drone (même logique) · habitat/rover → sorties/engin · walk-home → temps de sortie · ombre radio → zones mortes
béton · REMS/DONKI → feu, IA, vent · mission control → PC du COS · carte A4 → fiche réflexe

## 11. Modèle IA (contrat)
- Entraînement : NIST mds2-2258 (1 000 runs, 3 locaux, baseline rapide)
  https://data.nist.gov/od/id/mds2-2258 · NIST mds2-2479 (20 000 runs, 6 locaux, ouvertures de portes, modèle
  principal) https://data.nist.gov/pdr/lps/ark:/88434/mds2-2479. Statut MODELED (CFAST).
- Validation sur essais réels : UL FSRI fsri-compartments-2018 (OBSERVED) https://github.com/ulfsri/fsri-compartments-2018
- Plan B : ml/generate.ts sur l'atelier, si les prédictions sur nos relevés simulés ne sont pas plausibles.
- Label : embrasement = premier instant où la température du local atteint 600 °C (config, MODELED, NIST). Vérifier
  d'abord si les fichiers NIST fournissent déjà un label ou une température de couche chaude.
- Pannes : valeurs > 150 °C masquées (NaN) comme dans P-Flash, plus un indicateur de panne par détecteur.
- Entrées : fenêtre de 60 s au pas d'échantillonnage du fichier NIST (à vérifier à l'ouverture). Le simulateur produit
  ses relevés au même pas. Features indépendantes de la géométrie : T, dT/dt sur 10/30/60 s, max, nombre de détecteurs
  en panne, temps depuis la première panne, mêmes statistiques pour les locaux voisins.
- Cibles : P(embrasement ≤ 30 s), P(embrasement ≤ 60 s), temps avant embrasement (régression, censurée).
- Découpage par run, jamais par pas de temps. Seuil de décision choisi pour un rappel ≥ 0,95 sur la validation.
  Métriques : taux de faux négatifs, PR-AUC, délai d'anticipation, calibration.
- Export : XGBoost → JSON (Booster.save_model) → app/src/ml/xgb.ts, plus golden.csv pour R8. Le GRU n'apparaît que
  dans le rapport, en comparaison.
- Kaggle : le dataset converti en Parquet est publié (citation NIST, licence https://www.nist.gov/open/license) ;
  lien dans MODEL_REPORT.md.

## 12. Drone (élément aéronautique, obligatoire)
- Caractéristiques d'un drone thermique industriel réel (autonomie, vitesse, vent max, résolution thermique) dans
  config.json avec source (MODELED). Aucune marque mise en avant dans l'interface.
- Trajet : tour du bâtiment à altitude fixe, décollage et retour sur l'engin.
- PNR batterie : à chaque point, retour à l'engin possible avec la réserve finale de config.json (même code que le PNR air).
- Zone d'exclusion au-dessus du panache, orientée par le vent Open-Meteo (DERIVED). Vol refusé si vent > limite (R7).
- Image thermique de toiture : température de toiture par local, tirée du simulateur avec bruit, SIMULATED,
  affichage PC uniquement (R5).
- Drone d'intérieur : classe des drones d'inspection à cage de protection (autonomie, vitesse, température maximale dans
  config.json, `droneIndoor`, avec sources, MODELED, « à valider »). Aucune marque dans l'interface. Pas de GPS à
  l'intérieur : chaque observation est horodatée ; dans la fumée, seule la thermique compte, avec une confiance plus basse.
- Vol simulé : en Tunisie, tout vol réel exige une autorisation préalable (à mentionner dans le README).
- Inspiration NASA ACERO (gestion de l'espace aérien des drones sur incendie) : citée dans le rapport et le pitch, pas de code.
