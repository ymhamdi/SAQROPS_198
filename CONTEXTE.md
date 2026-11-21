# PNR · Point de Non-Retour — contexte pour l'équipe

*État au samedi 21 novembre, 15 h 45. Dépôt des livrables : dimanche 22 novembre, **9 h 00 au plus tard** (on vise 8 h 00).*

---

## 1. L'idée en 30 secondes

Quand un binôme de pompiers entre dans une usine en feu, il ne sait pas si le local voisin va **s'embraser**
(flashover), ni s'il lui reste **assez d'air** pour ressortir. Le chef d'agrès et le COS décident à l'aveugle.

**PNR** dit, à chaque seconde : *l'engagement est-il encore tenable, par où sortir, et pourquoi.*

- Une **IA** lit les détecteurs de chaleur du bâtiment, même quand ils tombent en panne, et prévoit l'embrasement
  d'un local **30 à 60 s à l'avance**.
- Un calcul de **point de non-retour** sur l'air de l'ARI vérifie que le binôme ressort avant le sifflet (55 bar)
  en comptant un retour 1,5 fois plus lent que prévu.
- Le verdict **GO / NO-GO** s'affiche avec ses raisons sur le PC du COS, sur la tablette du chef de binôme et dans
  le masque (HUD). Un NO-GO reste verrouillé : **seul le COS peut ré-engager**.
- Un **drone** de reconnaissance (simulé) part de l'engin, fait le tour du bâtiment sans passer dans le panache et
  surveille sa propre batterie avec la même logique de point de non-retour.

> Le verdict est une **aide** : partout il est écrit « **Décision : COS** ».

**Phrase d'accroche possible :** *« Le point de non-retour, l'aviation le calcule pour chaque vol. Nous le
calculons pour chaque pompier qui entre dans le feu. »*

---

## 2. Le challenge (rappel du cahier des charges)

- **Aero-Entrepreneur**, Tunisian Aeroday, avec la Protection civile et INJAZ.
- **Sujet** : technologies aéronautiques + IA pour la **prévention, la détection et la gestion des incendies dans
  les bâtiments et sites industriels** (pas les feux de forêt).
- **Exigences du jury** : réalisme, interactivité temps réel, données réelles, simulation physique, BMC obligatoire,
  sécurité des personnes et de l'environnement.
- **Livrables obligatoires** :
  1. BMC.
  2. Compte rendu d'équipe.
  3. Carte d'empathie.
  4. Vidéo de 1 min.
  5. Rapport du modèle IA.
  6. Lien GitHub **public**.
  7. Présentation PDF.

  Plus un fichier récapitulatif sur le Drive.
- **Barème de présélection (110 pts)** :

  | Bloc | Points |
  |---|---|
  | BMC | 25 |
  | Compte rendu | 15 |
  | Carte d'empathie | 10 |
  | Réalisme, précision et sécurité | 10 |
  | Vidéo | 20 |
  | IA (rapport + repo) | 30 |

  **Pitch (35 pts)**, seulement pour les 6 équipes retenues.
- **Pièges** :
  - Livrable après 9 h 00 : refusé.
  - Présentation modifiée par rapport au PDF déposé : −10.
  - Même idée qu'une autre équipe : −5.
  - Moins de 2 personnes aux formations : −5.
  - En cas d'égalité, la solution la **moins chère** l'emporte.

---

## 3. Ce que fait le prototype

Une application web (aucun serveur, tout tourne dans le navigateur), sur un **site fictif** : un atelier de pièces
composites aéronautiques de 60 × 40 m. On y trouve :

- des bureaux, un TGBT, un local de charge Li-ion, un stockage de solvants, une cabine de peinture ;
- une halle avec autoclave, tables de drapage et congélateurs ;
- 3 sorties et 15 détecteurs de chaleur.

Aucune entreprise réelle n'est nommée.

| Écran | Pour qui | Contenu |
|---|---|---|
| **PC du COS** | COS | Plan en direct (locaux teintés d'après les détecteurs, alertes IA, portes, binôme, drone), verdict + raisons, air et PNR, objectifs, état des locaux, journal. Le COS peut cliquer un départ de feu, ouvrir ou fermer une porte, engager, ajouter ou retirer un objectif, ordonner l'évacuation, ré-engager. |
| **Tablette** | Chef de binôme | Verdict, prochain point, distance, pression, sortie prévue, marge PNR, alertes, messages du PC (« Nouvel itinéraire reçu »). Gros boutons pour les gants. |
| **HUD masque ARI** | Porteur ARI | Une seule alerte à la fois (icône + mot + couleur), flèche de direction, air et PNR. |
| **Fiche réflexe** | Binôme | Une page A4 imprimable : verdict, mission, air, plan, sorties, dangers de l'itinéraire avec consignes sourcées. |

**Données affichées honnêtement.** Chaque nombre porte une étiquette :

| Étiquette | Signification |
|---|---|
| `OBSERVED` | Mesure réelle |
| `DERIVED` | Calculée à partir de mesures (ex. le vent Open-Meteo) |
| `MODELED` | Hypothèse, corrélation ou norme |
| `SIMULATED` | Produit par notre simulation |
| `MOCK` | Valeur factice |

Dans la démo, les relevés des détecteurs et les prédictions sont `SIMULATED`, et c'est affiché.

---

## 4. Comment ça marche (version courte)

À chaque seconde de simulation, la chaîne est la suivante :

1. **Moteur feu** : un modèle physique par local, avec des corrélations publiées et citées (NFPA 72, Kawagoe, MQH,
   Heskestad, Alpert, Thomas, CFAST pour les jets de porte). Il donne la croissance du feu, la limite par la
   ventilation, la température et la descente de la couche de fumée, l'embrasement à 600 °C et la propagation par
   les portes ouvertes.
2. **Détecteurs** : chaque détecteur réagit avec retard, avec du bruit, et tombe **en panne au-delà de 150 °C**,
   comme dans la vraie vie.
3. **IA (XGBoost)** : elle lit seulement les 60 dernières secondes des détecteurs d'un local et de ses voisins, et
   prédit P(embrasement ≤ 30 s), P(embrasement ≤ 60 s) et le délai estimé.
4. **Règles et itinéraires** : des règles sur les détecteurs plus l'IA donnent un **coût par local**. L'A* calcule
   l'itinéraire et le temps vers la sortie la plus proche.
5. **Air ARI et point de non-retour.**
6. **Verdict** GO / NO-GO avec ses raisons, puis le **verrou NO-GO**.
7. Le PC diffuse le résultat à la tablette et au HUD (deux fenêtres du même navigateur, qui jouent le rôle de la radio).

### Les 8 règles de sécurité (chacune vérifiée par un test automatique)

| Règle | Contenu |
|---|---|
| R1 | L'IA peut seulement **aggraver** un verdict (GO → NO-GO), jamais l'adoucir. |
| R2 | « Décision : COS » sur le PC, la tablette et la fiche. Le HUD reste court. |
| R3 | Chaque nombre affiché porte son étiquette ; une valeur `SIMULATED` ne ressemble jamais à une mesure réelle. |
| R4 | Toutes les hypothèses sont dans `data/config.json`, chacune avec sa source. |
| R5 | Le verdict ne lit **que les détecteurs** (et l'IA), jamais la « vérité » du simulateur ni l'image du drone. |
| R6 | Un NO-GO ne revient jamais tout seul en GO. Seul le COS ré-engage, et c'est journalisé. |
| R7 | Drone : retour garanti avec 25 % de batterie, vol refusé si le vent dépasse la limite, jamais dans la zone du panache. |
| R8 | Les prédictions calculées dans le navigateur sont identiques à celles de Python, à 10⁻⁶ près. |

**L'élément aéronautique :**
- Le drone de reconnaissance : caractéristiques d'un drone thermique industriel réel, zone d'exclusion orientée par
  le **vrai vent** (Open-Meteo), point de non-retour batterie.
- La logique de **point de non-retour** elle-même, héritée de l'aéronautique et du spatial : le code vient de
  *Martian Map* (projet NASA Space Apps 2026, planificateur de sorties sur Mars avec réserve d'O₂, crédité dans le
  repo), adapté ici à l'air de l'ARI.

---

## 5. Le modèle IA : chiffres actuels et limites

**Données prévues :** les jeux de données publics **NIST P-Flash** (simulations CFAST de détecteurs de chaleur, la
référence scientifique sur ce problème). **Le serveur du NIST est en panne depuis 14 h 10** (erreurs 524) : un
téléchargement est retenté chaque minute.

**En attendant (plan B, prévu dès le départ) :** le modèle v1 est entraîné sur **5 000 scénarios** générés par notre
propre moteur feu, soit 364 990 exemples. Le découpage se fait **par scénario** : 70 % entraînement, 15 % validation,
15 % test.

Résultats sur le jeu de test :

| Mesure | Résultat |
|---|---|
| Embrasement ≤ 60 s : rappel | **0,95** (seuil choisi pour rappel ≥ 0,95) |
| Embrasement ≤ 60 s : précision | 0,52 |
| PR-AUC (≤ 60 s) | **0,76**, contre 0,32 pour une règle simple sur la pente de température |
| Embrasements manqués | **12 sur 905** |
| Délai d'anticipation médian | **94 s** (10 % des cas : moins de 52 s) |
| Erreur moyenne sur le délai estimé | 46 s |

**Limite à dire franchement au jury :** un modèle entraîné sur notre propre simulateur apprend notre simulateur. C'est
pour ça qu'on veut :

1. réentraîner sur NIST dès que le serveur revient ;
2. valider sur les **essais réels UL FSRI** (étiquette `OBSERVED`) ;
3. faire valider les hypothèses par la Protection civile.

---

## 6. Avancement

| Ce qui est fait | État |
|---|---|
| Import de Martian Map, nettoyage | ✅ |
| Site fictif, grille 0,5 m, toutes les hypothèses sourcées dans `data/config.json` | ✅ |
| Moteur feu + 14 tests (valeurs de manuel, remplissage de fumée NFPA 92 à un facteur 2 près, porte fermée) | ✅ |
| Contrat du modèle (13 entrées, 3 modèles), évaluateur sans dépendance dans le navigateur | ✅ |
| Modèle v1 (plan B) entraîné et intégré | ✅ |
| PC du COS, tablette, HUD, fiche réflexe | ✅ |
| Drone (boucle, panache, PNR batterie, vent réel) | ✅ |
| Consignes réflexes sourcées (ERG 2024, OSHA, NFPA 70E, EN 137) | ✅ à **valider par un humain** |
| Script vidéo complet joué de bout en bout (test automatique + vérification dans un vrai navigateur) | ✅ |
| 161 tests automatiques verts, build OK | ✅ |
| Réentraînement sur NIST | ⏳ serveur NIST en panne |
| Validation sur les essais réels UL FSRI | ⏳ |
| `MODEL_REPORT.md`, `README.md` en français, `CREDITS.md` | ⏳ |
| Push sur GitHub (repo public) et déploiement Vercel | ⏳ |

---

## 7. Le scénario de la vidéo (1 min)

Lancer le PC, mettre **×20** puis **Lecture**. Les temps sont en temps simulé.

| T+ | Action | Ce qu'on voit |
|---|---|---|
| 0 s | **Départ de feu (scénario : stockage solvants)** | Le local de stockage se teinte au fil des relevés. |
| 60 s | **Décoller le drone** | Boucle partielle autour du bâtiment, demi-tour de chaque côté du panache, batterie et marge PNR. |
| 100 s | **Engager le binôme** (victime dans la cabine de peinture, puis coupure TGBT) | **GO**, itinéraire bleu, sortie prévue à 239 bar. |
| ≈ 214 s | (rien, ça arrive tout seul) | **NO-GO : « Embrasement prévu Cabine de peinture sous 60 s »**. Itinéraire rouge vers la sortie Ouest, alerte sur tablette et HUD. |
| ≈ 229 s | Cliquer la **porte stockage ↔ cabine** pour la fermer | Le délai prédit remonte (probabilité 0,50 → 0,01, délai ≈ 107 → 219 s). **Le verdict reste NO-GO** ; bouton « Ré-engager (décision COS) ». |
| ≈ 259 s | (binôme sorti à **272 bar**) | Cocher « Vérité simulateur » : l'embrasement réel de la cabine (à 286 s si la porte reste ouverte) montre que l'IA avait **72 s d'avance**. |
| ensuite | Décocher l'objectif « Victime – cabine », cliquer **Ré-engager** | Nouvel itinéraire vers le TGBT, **GO**, reçu en direct sur la tablette. |
| fin | **Fiche réflexe**, puis **Imprimer** | La fiche A4 avec les consignes sourcées. |

Ouvrir la **tablette** et le **HUD** depuis le PC (boutons « Ouvrir la tablette » et « Ouvrir le HUD ») et mettre
les trois fenêtres côte à côte pour l'enregistrement.

---

## 8. Lancer le projet sur votre machine

Il faut **Node.js 22.12 ou plus récent** (24 recommandé). Puis :

```bash
cd app
npm install
npm run dev
```

Ouvrir **http://localhost:5173**. Écrire bien `localhost`, pas `127.0.0.1`.

- Tablette : `http://localhost:5173/?view=tablet`
- HUD : `http://localhost:5173/?view=hud`

Les deux doivent être ouverts dans le **même navigateur** que le PC.

**Autres commandes, dans `app/` :**

```bash
npm test           # tests
npm run typecheck  # vérification des types
npm run build      # version de production
```

**Entraîner le modèle** (Python 3.12 conseillé) :

```bash
pip install -r ml/requirements.txt
node ml/generate.ts --n 5000 --seed 42 --out ml/data/scenarios.csv
python ml/train.py --data ml/data/scenarios.csv --name "plan B"
```

**Rafraîchir le vent réel :** `node scripts/fetch-weather.ts`

---

## 9. Où trouver quoi dans le repo

| Chemin | Contenu |
|---|---|
| `CLAUDE.md` | Règles du projet (règles de sécurité, conventions, jalons) |
| `data/config.json` | **Toutes** les hypothèses chiffrées, avec leur source |
| `data/SOURCES.md` | Les références de chaque corrélation et de chaque jeu de données |
| `data/site/atelier.json` | Le plan du site fictif |
| `data/consignes.json` | Les consignes réflexes sourcées |
| `data/weather/open-meteo.json` | Le vent réel mis en cache |
| `app/src/fire/` | Le moteur feu |
| `app/src/ml/` | Les entrées du modèle et l'évaluateur XGBoost |
| `app/src/danger/` | Les règles, l'IA, la fusion « ne peut qu'aggraver » |
| `app/src/stats/` | L'air ARI, le point de non-retour, le verdict, le verrou |
| `app/src/drone/` | Le drone |
| `app/src/sim/` | La boucle de simulation (dans un Web Worker) |
| `app/src/panels/` | Le PC, la tablette, le HUD, la fiche réflexe |
| `ml/` | Contrat du modèle, génération des données, entraînement, modèles exportés, métriques |

---

## 10. Ce qu'il reste et qui peut aider

**Côté technique**
- Réentraîner sur NIST P-Flash dès que le serveur revient, puis comparer avec le plan B.
- Valider le modèle sur les essais réels UL FSRI.
- Rédiger `ml/MODEL_REPORT.md` (exigé : architecture, pourquoi ce modèle, jeu de données, résultats, limites,
  plan de validation avec la Protection civile).
- Rédiger le README en français et `CREDITS.md` (Martian Map, sources, usage d'un assistant IA pour le code).
- Pousser sur GitHub (le repo **doit être public**) et déployer sur Vercel.

**Côté équipe (aide bienvenue)**
- **Relire `data/consignes.json` ligne par ligne contre les sources citées** (ERG 2024 notamment). Ces consignes
  ont été rédigées avec un assistant IA : un humain doit les vérifier.
- **Vidéo** : suivre le scénario de la section 7. Le temps simulé ×20 fait tenir l'histoire en environ 30 s, plus
  les clics.
- **BMC, compte rendu, carte d'empathie, présentation** : réutiliser les chiffres des sections 5 et 7, et le coût
  (voir ci-dessous).
- **Questions à poser à la Protection civile** :
  - Bouteille ARI : 6,8 L à 300 bar ?
  - Consommation d'air : 60 / 80 L/min ?
  - Vitesses de progression en fumée : 1 / 0,5 / 0,25 m/s ?
  - Règle de retour ×1,5.
  - Pertinence des consignes.
  - Intérêt pour un pilote.

**Arguments coût (départage en cas d'égalité) :**
- Le logiciel réutilise les détecteurs de chaleur **déjà installés** dans les bâtiments.
- Il tourne dans un simple navigateur, sans serveur ni licence.
- Le drone est un équipement que la Protection civile peut mutualiser entre plusieurs interventions.

---

## 11. Limites à assumer devant le jury

- Le site, le feu, les relevés et le vol du drone sont **simulés**. C'est affiché partout (`SIMULATED`).
- Les hypothèses d'air et de vitesse sont des **ordres de grandeur à valider** par la Protection civile.
- Le modèle v1 est entraîné sur notre simulateur, en attendant NIST (voir section 5).
- La position du binôme est **simulée** (`MOCK`). En vrai, il faudrait un système de localisation des pompiers en
  intérieur, comme le POINTER de la NASA.
- En Tunisie, tout vol réel de drone exige une **autorisation préalable**.
- PNR **aide** à décider, il ne décide pas : **Décision : COS**.
