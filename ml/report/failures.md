# Embrasements manqués

Modèle : plan B v3 (feux limités, feux rapides, étanchéité variable) (`ml/runs/planB-v3`), seuil P(≤ 60 s) 0.391 fixé en validation pour un rappel ≥ 0,95 par pas de temps.
Un embrasement est manqué quand l'alerte à 60 s ne s'est levée à aucun moment avant lui.

## Test interne (données plan B, découpage par scénario)

487 embrasements détectés sur 493 ; 6 manqués. Délai d'anticipation médian 99 s, P10 58 s. Fausses alertes : 342 locaux sur 1729 qui ne s'embrasent jamais.

| Caractéristique | Embrasements manqués | Tous les embrasements du test |
|---|---|---|
| Vitesse de croissance du feu | medium 50 %, ultraFast 33 %, slow 17 % | fast 37 %, medium 35 %, ultraFast 21 %, slow 8 % |
| Type de feu | limité par le combustible 67 %, limité par la ventilation 33 % | limité par la ventilation 75 %, limité par le combustible 25 % |
| Local | local du départ de feu 83 %, local voisin (propagation) 17 % | local du départ de feu 52 %, local voisin (propagation) 48 % |
| Portes ouvertes du local (fin) | 1 porte(s) 100 % | 1 porte(s) 60 %, 2 porte(s) 35 %, 3 porte(s) 4 %, 0 porte(s) 1 % |
| Parois | gypsum 83 %, concrete 17 % | gypsum 72 %, concrete 28 % |

Instant moyen de l'embrasement manqué : 447 s après le début du scénario (tous : 422 s).

## UL FSRI

10 embrasements détectés sur 11 ; délai médian 42 s. Fausses alertes : 72 locaux sur 109 qui ne s'embrasent jamais.

Manqués : `Overstuffed_Open_Center_1` (embrasement à 222 s)

Généré par `ml/failures.py` ; ne pas éditer à la main.
