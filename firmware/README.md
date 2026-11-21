# Micrologiciels PNR : drone (ESP32) et HUD binôme (STM32)

Deux cartes USB branchées au PC du COS, lues directement par le navigateur (Web Serial, Chrome ou Edge). **Aucun serveur** :
tout tourne dans la page. Chaque valeur affichée dit d'où elle vient (voir « Étiquettes »).

```text
ESP32 + GY-BMP280 + microswitch ──USB──┐
   (drone-payload)                     ├──► navigateur (PC du COS) ──► verdict GO / NO-GO ──► « Décision : COS »
STM32 + potentiomètre + IR + LCD ──USB─┘            ▲                          │
   (binome-hud)  ◄──── {"cmd":"alert","level":...} ──┴──────────────────────────┘
```

> **État de validation, dit franchement.** Ces croquis n'ont **pas été compilés ni téléversés** ici (pas de chaîne Arduino
> sur la machine de développement) : ils sont écrits contre les bibliothèques indiquées ci-dessous. Ce qui est testé
> automatiquement : le protocole côté navigateur, la chaîne complète avec de faux ports USB, et la **cohérence des croquis avec
> l'application** (`app/src/hardware/firmware.test.ts` lit les croquis : même vitesse, mêmes capteurs, mêmes locaux, mêmes
> broches, et les lignes JSON qu'ils impriment passent dans l'analyseur de l'application). Le premier essai sur la carte reste à
> faire : voir « Essai sur table ».

## 1. Câblage

### Carte 1 : `drone-payload` (ESP32 DevKit, 7 fils, **3,3 V strict**)

Ne jamais brancher le GY-BMP280 sur `5V` ou `VIN`.

| Module | Broche module | Broche ESP32 | Rôle |
|---|---|---|---|
| GY-BMP280 | VCC | `3V3` | alimentation |
| GY-BMP280 | GND | `GND` | masse |
| GY-BMP280 | SCL | `GPIO 22` | I2C SCL |
| GY-BMP280 | SDA | `GPIO 21` | I2C SDA |
| GY-BMP280 | CSB | *non connecté* | mode I2C |
| GY-BMP280 | SDO | *non connecté* | adresse `0x76` (repli `0x77`) |
| Microswitch à levier (module « crash sensor ») | VCC | `3V3` | LED du module |
| Microswitch | GND | `GND` | masse |
| Microswitch | OUT | `GPIO 4` | `INPUT_PULLUP` ; un front descendant `HIGH → LOW` passe au local suivant (anti-rebond 200 ms) |

### Carte 2 : `binome-hud` (STM32 Blue Pill ou Nucleo, 10 fils)

| Module | Broche module | Broche STM32 | Rôle |
|---|---|---|---|
| Potentiomètre rotatif (vanne de la bouteille ARI) | patte gauche | `3V3` | référence haute |
| Potentiomètre | curseur (milieu) | `PA0` / `A0` | entrée analogique, `0–1023` ↔ `0–300 bar` linéaire |
| Potentiomètre | patte droite | `GND` | référence basse |
| Capteur IR d'obstacle MH-B (MAYDAY sans contact) | VCC | `3V3` | alimentation |
| MH-B | GND | `GND` | masse |
| MH-B | OUT | `PA1` / `A1` | actif bas : `LOW` quand une main passe à environ 5 cm → `mayday: 1` |
| Écran LCD 16×2 avec module I2C **(facultatif)** | GND | `GND` | masse |
| LCD | VCC | `5V` | rétroéclairage |
| LCD | SDA | `PB7` / `D14` | I2C SDA (tolère 5 V) |
| LCD | SCL | `PB6` / `D15` | I2C SCL (tolère 5 V) ; adresse `0x27`, repli `0x3F` |

Si l'écran est absent, le croquis fonctionne quand même : seul l'affichage manque.

## 2. Téléversement

| | Drone | HUD binôme |
|---|---|---|
| Croquis | `drone_payload/drone_payload.ino` | `binome_hud/binome_hud.ino` |
| Noyau | ESP32 (Arduino-ESP32) | STM32duino |
| Carte | « ESP32 Dev Module » | « Generic STM32F103C series » (Blue Pill) ou la Nucleo |
| Réglage | : | *USB support* : `CDC (generic 'Serial' supersede U(S)ART)` sur Blue Pill ; sur Nucleo, `Serial` est le port COM virtuel du ST-Link |
| Bibliothèques | **Adafruit BMP280 Library** (et *Adafruit Unified Sensor*) | **LiquidCrystal_I2C** |

Une puce vendue sous le nom « BMP280 » peut être un BME280 (identifiant `0x60`) : si le croquis écrit
`BMP280 introuvable`, essayer `bmp.begin(0x76, 0x60)`.

## 3. Protocole série (115200 bauds, JSON terminé par `\n`)

Les lignes qui ne sont pas du JSON (bannière de démarrage, texte de diagnostic) sont **ignorées** par l'application.

**`drone-payload` → navigateur**, deux lignes toutes les 500 ms. Le `room` vaut `sas-entree`, `atelier` ou `stockage-solvants` (l'appui
sur le microswitch passe de l'un au suivant) :

```json
{"seq": 42, "t_ms": 183500, "source": "drone-payload", "sensor": "temp_bmp280", "value": 54.20, "unit": "C", "room": "stockage-solvants"}
{"seq": 43, "t_ms": 183500, "source": "drone-payload", "sensor": "alt_bmp280", "value": 0.35, "unit": "m", "room": "stockage-solvants"}
```

L'altitude est **relative** : la pression au démarrage sert de référence. Sans capteur, le croquis n'envoie **aucune valeur** (jamais
de valeur inventée).

**`binome-hud` → navigateur** : la pression toutes les 400 ms, le MAYDAY au moment du déclenchement :

```json
{"seq": 101, "t_ms": 184000, "source": "binome-hud", "sensor": "ari_bar", "value": 145.0, "unit": "bar", "room": "binome-1"}
{"seq": 102, "t_ms": 184120, "source": "binome-hud", "sensor": "mayday", "value": 1, "unit": "bool", "room": "binome-1"}
```

Le MAYDAY est confirmé 30 ms, émis une seule fois par geste, puis réarmé après 1 s sans main.

**navigateur → `binome-hud`** : à chaque changement de verdict (et à la connexion du HUD) :

```json
{"cmd":"alert","level":"NO-GO"}
{"cmd":"alert","level":"GO"}
```

L'écran affiche `!!! NO-GO !!!` ou `PNR   GO`, et la pression (`AIR 145 bar`, avec `SOS` après un MAYDAY).

## 4. Dans l'application (panneau « Télémétrie matérielle » du PC)

1. **Connecter le drone (ESP32)** et **Connecter le HUD binôme (STM32)** : le navigateur demande le port à chaque fois. Un seul
   programme peut tenir un port : fermer le moniteur série d'Arduino.
2. **Seuil déclenchement (°C)**, 35 par défaut : une lecture du drone `≥` seuil rend le local **critique**, le verdict passe à
   **NO-GO** avec la raison « Chaleur anormale relevée par la charge utile — *local* », et l'ordre `NO-GO` part au HUD.
3. **Facteur Mode Démo**, 10 par défaut : la température *modélisée* vaut `relevé × facteur` (ce que donnerait un feu industriel,
   avec un sèche-cheveux pour le relevé). Le facteur est toujours affiché avec la valeur.
4. **Pression ARI** : la pression du potentiomètre alimente le point de non-retour. À 110 bar avec la mission à faire, le budget d'air
   échoue : NO-GO.
5. **MAYDAY** : NO-GO immédiat, équipe rappelée, raison « ALERTE MAYDAY matérielle déclenchée par le chef de binôme ».
6. **Test NO-GO HUD** : envoie `NO-GO` au HUD pour vérifier l'écran, sans toucher au verdict.
7. **Ré-engager (Décision : COS)** : le seul moyen d'effacer un danger relevé par le matériel, et d'envoyer `GO` au HUD.

Correspondance des locaux (`data/config.json`, `hardware.roomAliases`) : `stockage-solvants` → Stockage solvants ; `atelier` et
`sas-entree` → Halle de production (le plan du site n'a pas de sas).

### Enregistrer et rejouer

- **Enregistrer session** : enregistre les paquets reçus par USB avec leur `delta_ms` (millisecondes depuis le début) ;
  **Arrêter et télécharger** donne `pnr-replay.json`.
- **Rejouer démo** joue la séquence intégrée ; **Charger un rejeu…** joue un fichier. Tout est étiqueté `REPLAY`, sous une bannière
  qui ne dit jamais « en direct ». Pendant un rejeu, l'USB n'est pas écouté.

## 5. Règle de sécurité R13 : le matériel ne peut qu'aggraver

- Une lecture qui **baisse**, un capteur **silencieux**, un paquet **manquant**, une bouteille qui lit **plus pleine** que le modèle : aucun
  ne rend un local sûr ni ne ramène le verdict à GO. Un local critique et un MAYDAY **restent** jusqu'à la décision du COS.
- La pression du potentiomètre sert **si elle est plus basse** que celle du modèle ; plus haute, elle est ignorée.
- Si le local est toujours chaud après la décision du COS, son prochain paquet relève le danger de nouveau.
- Les tests : `app/src/hardware/hardwareSim.test.ts` (dont une propriété sur des séquences aléatoires), `ingest.test.ts`, `pipeline.test.ts`.

## 6. Étiquettes (R3) : d'où vient chaque valeur

| Valeur | Étiquette |
|---|---|
| Température, altitude, pression reçues **en direct** par l'USB | `OBSERVED` |
| Température × facteur (mode démo) | `MODELED`, avec le facteur affiché (jamais `OBSERVED`) |
| Les mêmes valeurs **rejouées** depuis un enregistrement | `REPLAY` (la valeur mise à l'échelle aussi) |
| Point de non-retour calculé depuis la pression lue | `MODELED` (entrée mesurée, calcul modélisé) |

**Bannières de rejeu.** Un fichier **enregistré par l'application depuis le port USB** porte `REJEU d'une mesure réelle`. La séquence
**intégrée** est écrite à la main (24 °C puis 48 °C, 220 puis 110 bar) : ce n'est **pas** une mesure, et sa bannière le dit
(`REJEU d'une séquence de démonstration intégrée — valeurs écrites à la main, pas une mesure`). Un fichier d'origine inconnue
est présenté comme tel. Appeler « mesure réelle » une suite inventée serait une fausse provenance devant le jury.

## 7. Essai sur table

1. Ouvrir le moniteur série à 115200 bauds : le drone doit imprimer deux lignes JSON toutes les 500 ms. Appuyer sur le microswitch :
   le `room` change. Souffler de l'air chaud sur le capteur : `value` monte.
2. Le HUD doit imprimer `ari_bar` toutes les 400 ms ; tourner le potentiomètre fait varier `value` de 0 à 300. Passer la main devant le
   MH-B : une ligne `mayday`.
3. Envoyer `{"cmd":"alert","level":"NO-GO"}` depuis le moniteur : l'écran affiche `!!! NO-GO !!!`.
4. Fermer le moniteur, ouvrir l'application, connecter les deux cartes.
5. En cas de panne USB le jour de la démonstration : **Rejouer démo**, ou rejouer un enregistrement fait la veille.

## 8. Limites

- Croquis non compilés ni téléversés ici (voir plus haut).
- Le cahier des charges reçu s'arrête en cours de route dans la section du micrologiciel du drone : le croquis du HUD est écrit
  d'après le protocole et le câblage donnés, pas d'après un texte de référence.
- Un relevé de température de sèche-cheveux n'est pas un relevé d'incendie : c'est pourquoi la valeur mise à l'échelle est
  `MODELED`. Le seuil de 35 °C est un choix de démonstration, à remplacer par une valeur validée avec la Protection civile.
- Web Serial : Chrome ou Edge, page servie en `localhost` ou en HTTPS.
