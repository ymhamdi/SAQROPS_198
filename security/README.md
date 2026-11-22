# Audit de sécurité de PNR (22/11/2026)

Audit en profil **quick** (une vague de chasseurs, une revue de couverture, un vérificateur indépendant par piste) avec le skill
`cloudflare/security-audit-skill`, sur `main` au commit `c91771c` (matériel USB, firmware et copilote compris).
**Lecture du code seulement** : aucun bac à sable n'existe sur la machine (Windows, ni WSL ni conteneur), donc rien n'a été exécuté
pendant l'audit et aucune faille ne pouvait être « confirmée ».

Détails : [REPORT.md](REPORT.md) (rapport) et [NEEDS-VALIDATION.md](NEEDS-VALIDATION.md) (pistes avec trace du code et test local).
Les fichiers complets de l'audit (plan de couverture, `findings.json`, invites des agents) sont hors du dépôt, dans
`C:\Users\MSI\security-audit-skill\hack\run-1\`.

## Résultat

12 pistes : **4 à valider**, **8 réfutées** par un vérificateur qui ne les avait pas cherchées. Pas de secret, pas de mode débogage,
pas d'injection : l'application est client seulement, sans serveur ni compte. Le risque porte sur **l'intégrité de la logique de
sécurité** (les règles R1 à R13), pas sur le vol de données.

## Corrigé sur cette branche (`security`)

| Piste ou durcissement | Correctif | Test |
|---|---|---|
| Un MAYDAY ne rappelait pas une équipe engagée alors qu'un NO-GO était déjà verrouillé (R13) | rappel à chaque nouveau danger matériel (`sim/sim.ts`) | `security/leads.test.ts` : **reproduit en échec sur `c91771c`**, puis réussi |
| Un relevé REPLAY qui relevait la valeur d'un relevé direct gardait l'étiquette OBSERVED (R3) | étiquette la plus faible (`hardware/state.ts`) | idem : reproduit, puis réussi |
| La pression de la bouteille était ignorée après « Réinitialiser » (la porte de filtrage gardait sa dernière valeur) | `EventGate.clearAri()` appelée quand la simulation repart sans pression | `leads.test.ts` |
| Vent illisible (absent, NaN) : le vol du drone n'était pas refusé (R7) | refus si le vent n'est pas fini (`drone/drone.ts`) | `leads.test.ts` |
| Les fenêtres tablette, HUD et jumeau acceptaient n'importe quel message du canal (un message mal formé démonte la fenêtre) | contrôle de forme à la réception (`live/validate.ts`, `live/channel.ts`) | `leads.test.ts` |
| Une alerte MAYDAY pouvait sortir de l'écran du PC après 50 échanges sans accusé de réception | les MAYDAY ouverts sont gardés à part du journal (`copilot/log.ts`) | contrôle de forme testé ; la liste séparée n'a pas de test dédié |
| Un arbre XGBoost abîmé pouvait boucler sans fin ou lire hors arbre | borne de parcours et contrôle des indices (`ml/xgb.ts`) | `leads.test.ts` |
| CI : jeton à droits par défaut, identifiants laissés dans le checkout | `permissions: contents: read`, `persist-credentials: false` | — |
| `data/SOURCES.md` : trois liens de téléchargement à jeton | retirés, le SHA-256 identifie les fichiers | — |
| `.gitignore` : motifs de secrets manquants | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials*.json` | — |

## Pas corrigé (à décider)

- **Pas de maître unique sur le canal** : une deuxième fenêtre `?demo=1` ou un deuxième onglet PC reste un deuxième maître. Il faudrait un
  identifiant de maître et un numéro de séquence dans le snapshot.
- **Engager sous un NO-GO verrouillé** reste possible (décision du COS) ; seul le MAYDAY rappelle maintenant l'équipe.
- Les unités **différées** du rapport (cycle de vie du panache du drone, drone d'intérieur, rendu du HUD, inondation d'événements USB,
  chaîne d'outils du firmware) n'ont pas été revues.
- Les notes de durcissement du rapport (accusé de réception du MAYDAY, battement de cœur du HUD, plafonds du fichier de rejeu,
  `jury_demo.py`, etc.).

## Limites de cette branche

Les correctifs ont été testés par cible (`src/security`, `src/hardware`, typecheck). **La suite complète et le build n'ont pas été
relancés après la dernière modification** : à faire avant toute fusion (`cd app && npm test && npm run build`).
Les rapports décrivent l'état de `c91771c` : les verdicts des pistes sont ceux de l'audit, avant ces correctifs.
