# BRIEF — PNR · Point de Non-Retour (pitch Aero-Entrepreneur)

*Lu dans le repo le 22/11/2026 à 04:15–04:40. Tout ce qui n'est pas dans le repo est marqué [À VÉRIFIER].*

## En une phrase
Aide à la décision pour la Protection civile : à chaque seconde, PNR dit au COS (PC) et au chef de binôme (tablette, HUD du masque ARI) si l'engagement dans un incendie de site industriel est encore tenable, par où sortir, et pourquoi. **Décision : COS.**

## Ce qui rend la solution unique (à dire tôt)
1. **Le point de non-retour de l'aviation, appliqué au pompier** : code hérité de *Martian Map* (NASA Space Apps), O₂ de scaphandre → air de l'ARI (sifflet 55 bar, retour ×1,5), vérifié **en chaque point** de l'itinéraire.
2. **Une IA qui voit venir l'embrasement 30–60 s avant**, avec les détecteurs de chaleur *déjà installés*, **même après leur panne** (> 150 °C).
3. **Une IA qui ne peut qu'aggraver** (GO → NO-GO), NO-GO verrouillé, seul le COS ré-engage : 12 règles de sécurité, chacune avec un test.
4. **Répéter avant d'entrer** : un drone d'intérieur découvre un passage obstrué, la mission est rejouée en vue première personne, le COS valide le plan.
5. **Honnêteté des données** : chaque nombre porte OBSERVED / DERIVED / MODELED / SIMULATED / MOCK.

## Partie aéronautique (exigée par le jury)
- **Drone de reconnaissance extérieur** (simulé) : décolle de l'engin, tour du bâtiment à 30 m, **zone d'exclusion du panache orientée par le vent Open-Meteo** (DERIVED), **PNR batterie** (retour garanti avec 25 % de réserve), vol refusé si vent > 12 m/s, image thermique des toits (affichage PC seulement). Caractéristiques d'une classe de drones thermiques industriels (MODELED).
- **Drone d'intérieur** (simulé) : classe « cage de protection » — autonomie 9 min, 1,5 m/s, 50 °C max (fiches constructeur, MODELED). N'ouvre jamais une porte ; observations horodatées ; local non visité = INCONNU.
- **Logique de PNR** (batterie = air) héritée de l'aéronautique/spatial. Inspiration NASA ACERO (citée, pas de code).
- Vol réel en Tunisie : autorisation préalable obligatoire (dit dans le README).
- Branche `firmware` (non fusionnée, **non testée sur carte**) : drone ESP32 + HUD STM32 via Web Serial, règle R13 « le matériel ne peut qu'aggraver ».

## Modèle IA (voir `ml/MODEL_REPORT.md`)
- **3 XGBoost** (p30, p60, délai) sur **13 variables** tirées des seuls détecteurs (pannes = NaN). Évaluateur TypeScript de ~85 lignes dans le navigateur, parité Python 10⁻⁶ (R8).
- **Entraînement** : 5 000 scénarios de notre moteur feu (364 990 exemples, découpage par scénario) — MODELED. NIST P-Flash (mds2-2258, mds2-2479) prévu, **non utilisé** (serveur NIST HS le 21/11).
- **Validation réelle** : UL FSRI *fsri-compartments-2018*, 120 essais (OBSERVED).
- **Résultats simulés** : rappel 0,946 (≤ 60 s), précision 0,517, PR-AUC 0,761 (règle simple : 0,315), 893/905 embrasements annoncés, avance médiane 94 s.
- **Résultats réels (honnêtes)** : 11/11 embrasements annoncés, avance médiane 54 s, **mais 92/109 fausses alertes (84 %)** ; v3 candidate : 10/11 et 72/109 (66 %), non livrée.
- Démo (SIMULATED, graine 42) : NO-GO à T+3:34, **72 s d'avance** sur l'embrasement, binôme dehors à 272 bar (sifflet 55).

## Stack
Vite + React + TypeScript, simulation dans un Web Worker, aucune dépendance serveur, hors ligne ; Python (XGBoost 3.4.1) pour l'entraînement ; **327 tests** sur `main`. Dépôt : `ymhamdi/SAQROPS_198` — **privé aujourd'hui** (voir alertes).

## Chiffres externes utilisés dans le deck (vérifiés par lecture de la page, à re-vérifier)
| Chiffre | Source |
|---|---|
| 16 021 incendies en 2021, soit 44 par jour | Statistiques Protection civile, cité par WMC/TAP, 13/06/2022 — webmanagercenter.com/2022/06/13/487945/ |
| Indemnités d'incendie : 32,8 MDT (2016) → 107,2 MDT (2020) ; fumée = 1re cause de décès | Hichem Saied, FTUSA, même article |
| ~600 incendies en 48 h, « un feu toutes les cinq minutes » (juillet 2026, tous types d'incendie) | Protection civile via Business News, 21/07/2026 — **non utilisé sur les slides** (feux de forêt inclus) |
| 4 519 entreprises industrielles (≥ 10 salariés) | APII via Business News, 14/09/2026 — lu dans un résumé de recherche, **pas sur la page** |
| 125 unités permanentes de la Protection civile | article d'août 2025 (allAfrica) — lu dans un résumé de recherche, **pas sur la page** |
| Drone thermique ≈ 5 700 € (prix détail UE) ; drone d'intérieur à cage 6 500–40 000 USD | listes de prix revendeurs, 22/11/2026 — ordre de grandeur |

## Ce qui manquait dans le repo (hypothèses faites)
| Manque | Ce que j'ai fait |
|---|---|
| Coûts | Estimation d'équipe : 0 TND de licence ; pilote minimal ≈ 3 000 TND ; pilote complet ≈ 28 000 TND (22 400 matériel + 25 % de marge) ; 1 € = 3,4 TND [À VÉRIFIER] |
| BMC | Construit depuis `PRODUCT.md`/`CONTEXTE.md` (`BMC.md`) |
| Carte d'empathie | Hypothèse sur la doctrine publique, jamais interviewé un pompier (`EMPATHY.md`) — dit sur le slide |
| Équipe | Seul « Youssef Mhamdi » (auteur git) est connu : `config.json` |
| Lien vidéo | vide → le slide affiche un cadre rouge « [À VÉRIFIER] » tant que `config.json` n'est pas rempli |
| Langue / couleurs | Français ; feu (orange/rouge) + aéro (cyan) + HUD sombre, polices Barlow du projet |

## Points faibles pour le jury (et le cadrage choisi)
1. **Tout est simulé, aucune intervention réelle, aucune validation Protection civile.** → on le dit sur le slide 7 et on vend un *pilote de validation*, pas un produit fini.
2. **84 % de fausses alertes sur essais réels (v1).** → on l'affiche (slide 6). Cadrage : l'IA ne peut qu'aggraver, donc une fausse alerte coûte du temps, pas la sécurité ; et c'est exactement ce que le pilote doit régler.
3. **Dépôt privé.** → le jury doit pouvoir ouvrir le lien : à rendre public avant 09:00.
4. **« Limites des pratiques actuelles » en Tunisie** : aucune source trouvée sur la doctrine réelle → formulé comme hypothèse à valider.
