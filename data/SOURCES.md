# Sources

Every number PNR uses lives in [config.json](config.json) with its source and status (CLAUDE.md R4). This page lists
the references behind them and the datasets. Status: **OBSERVED** measured · **DERIVED** computed from observations ·
**MODELED** our assumption, a correlation or a normative value · **SIMULATED** produced by our fire engine during the
demo · **MOCK** placeholder.

## Site — MODELED

`site/atelier.json`: a fictional composite-parts workshop (60 × 40 m) drawn by the team. No real company. The
coordinates are approximate and only used to fetch the outdoor wind; the plan is never drawn over a real map.

## Fire engine (`app/src/fire/`) — MODELED correlations, SIMULATED output

| What | Correlation | Reference |
|---|---|---|
| Fire growth | Q = α·t², α slow/medium/fast/ultra-fast = 0.00293 / 0.01172 / 0.0469 / 0.1876 kW/s² | NFPA 72, Annex B; SFPE Handbook of Fire Protection Engineering (5th ed.), design fires |
| Ventilation limit | Q ≤ 1500·Σ A·√H (kW) | Kawagoe (1958), Fire behaviour in rooms, BRI Report 27; SFPE Handbook |
| Door jet fires | the excess fuel of a ventilation-limited room burns beyond its open doors | Peacock et al., CFAST Technical Reference Guide (NIST TN 1889v1) |
| Hot-layer temperature | ΔT = 6.85·(Q²/(A·√H·hk·AT))^(1/3) | McCaffrey, Quintiere & Harkleroad (1981), Fire Technology 17(2):98-119; SFPE Handbook, Walton & Thomas |
| Wall heat loss | hk = √(kρc/t) before thermal penetration, k/δ after | SFPE Handbook, Walton & Thomas; Karlsson & Quintiere (2000), Enclosure Fire Dynamics, ch. 6 |
| Wall properties | concrete, gypsum board | Karlsson & Quintiere (2000), table 6.1 |
| Plume entrainment | ṁ = 0.071·Qc^(1/3)·z^(5/3) + 0.0018·Qc above the flame, 0.032·Qc^(3/5)·z within; L = 0.166·Qc^(2/5) | Heskestad, SFPE Handbook, fire plumes; NFPA 92 (2018) §5.5 |
| Smoke filling (test) | z/H = 1.11 − 0.28·ln(t·Q^(1/3)·H^(−4/3)/(A/H²)) | NFPA 92 (2018) §5.4 — used to check the engine within a factor 2 |
| Doorway outflow | ṁ = (2/3)·Cd·W·ρg·√(2g(Tg/Ta − 1))·(Hd − z)^(3/2) | Karlsson & Quintiere (2000), ch. 10; SFPE Handbook, vent flows |
| Flashover | hot layer ≥ 600 °C (default), or Q ≥ 7.8·AT + 378·A·√H | NIST P-Flash label (Tam et al.); Drysdale, An Introduction to Fire Dynamics; Thomas (1981), Fire and Materials 5(3):103-111 |
| Fire door | a closed EI 30 door holds 30 min | EN 13501-2 |

## Heat detectors — MODELED

| What | Correlation | Reference |
|---|---|---|
| Ceiling jet | ΔT = 16.9·Q^(2/3)/H^(5/3) (r/H ≤ 0.18), 5.38·(Q/r)^(2/3)/H beyond; u = 0.96·(Q/H)^(1/3) (r/H ≤ 0.15), 0.195·Q^(1/3)·H^(1/2)/r^(5/6) beyond | Alpert (1972), Fire Technology 8(3):181-195 |
| Response | dTe/dt = √u·(Tg − Te)/RTI | Heskestad & Smith; SFPE Handbook, detector response |
| Failure | no reading above 150 °C | NIST P-Flash (Tam et al. 2021) |

## Breathing apparatus (ARI) — MODELED

Low-pressure warning at 55 ± 5 bar: EN 137:2006. Cylinder, consumption and progression speeds: team assumptions to be
validated with the Protection civile (see config.json).

## Model training data

- NIST mds2-2258, *Synthetic Temperature Data for P-Flash* — 1 000 CFAST runs of a three-room structure, heat
  detector temperatures. https://data.nist.gov/od/id/mds2-2258 — **MODELED** (simulations, not measurements).
- NIST mds2-2479 — 20 000 CFAST runs, six rooms, door openings. https://data.nist.gov/pdr/lps/ark:/88434/mds2-2479 —
  **MODELED**.
- UL FSRI *fsri-compartments-2018* — full-scale compartment fire experiments, for validation.
  https://github.com/ulfsri/fsri-compartments-2018 — **OBSERVED**.
- NIST data are public (NIST license, https://www.nist.gov/open/license).

## Outdoor wind — DERIVED

Open-Meteo forecast API (analysis of numerical weather models, not a measurement on site), cached in
`weather/open-meteo.json`.

## Drone — MODELED

Endurance, speed, wind limit and thermal resolution of a current enterprise thermal drone class (manufacturer spec
sheets); reserve, altitude and no-fly cone are team assumptions. Flights are simulated: in Tunisia any real flight
needs prior authorisation.

## Indoor drone — MODELED (`hypotheses.droneIndoor`)

The class is the collision-tolerant indoor inspection drone with a protective cage. Its figures are those of the
manufacturer's current **Elios 3** documents, read on 2026-11-22 from the manufacturer's own files (not from reseller
copies). The brand appears in this file and in `config.json` sources only, never in the interface. Status stays MODELED:
the figures describe a real aircraft, but the simulated drone, the fire and the site are ours, and the Protection civile
has not yet validated them.

Documentation page of the manufacturer (lists every file below):
https://knowledge.flyability.com/aircraft/elios-3/elios-3-documentation

### The three figures

| Config key | Value kept | What the manufacturer prints | Where |
|---|---|---|---|
| `enduranceMin` | **9 min** | "Max. flight time 11.5 min (Elios 3 base), 9.1 min (Elios 3 + LiDAR)" | Technical Specifications v1.1, p.2 |
| | | "The flight time of the ELIOS 3 with the LiDAR sensor mounted is 9 minutes in total. Without the LiDAR sensor mounted, the flight time is 12 minutes and 30 seconds." | User Manual v1.3, section 2.4.3, p.23 |
| | | Standard battery: 12 min 30 s with no payload, 9 min 10 s with Rev 6 LiDAR, 9 min with Rev 7 LiDAR | Batteries Technical Specifications, p.3 |
| `cruiseMs` | **1.5 m/s** | "Max. horizontal speed: Assist mode 1.5 m/s (4.9 ft/s), Assist-Sport mode 2 m/s (6.6 ft/s), Attitude mode 5 m/s, Sport mode 7 m/s" | Technical Specifications v1.1, p.2 |
| | | "ASSIST mode ensures that you never exceed the maximum collision speed of the drone and is thus the safest mode to fly in." | User Manual v1.3, section 4.5.1, p.32 |
| | | "Max. safe collision speed 2 m/s (< 6.6 ft/s) in frontal collisions, 2.4 m/s (< 7.9 ft/s) in all spherical directions" | Technical Specifications v1.1, p.2 |
| `maxAmbientC` | **50 °C** | "Operating temperature 0 ºC to 50 ºC (32 °F to 122 °F)", footnote 1: "Valid for batteries pre-condition between 10 °C and 40 °C" | Technical Specifications v1.1, p.2 |
| | | "Max. ambient operating temperature: 50 °C, 122 °F" for the standard battery with no payload, Rev 6 and Rev 7 LiDAR (definition, note 3: "at sea-level and no-wind conditions at which a normal collision resilience and wind resistance can be expected") | Batteries Technical Specifications, p.3 |

How each value was chosen:

- **Endurance 9 min.** No document prints 10 min for the Elios 3. The sheet lists the SLAM-based LiDAR as the
  stabilisation system and the LiDAR payload as the base option, so the with-LiDAR figures are taken as applicable
  (9 to 9.1 min) and the lowest is kept. All of them are maxima "in ideal
  conditions: sea-level, 20 °C ambient temperature, new propellers and motors, new fully charged batteries, no wind and
  hovering" (Batteries Technical Specifications, p.3). The manual (p.23) lists what shortens it: a cold battery (< 20 °C),
  an old battery, wind or speed in Sport, many collisions, very confined spaces, damaged propellers, altitude. The 25 %
  reserve (`batteryReservePct`) is applied on top, by the drone code, not by this figure.
- **Cruise 1.5 m/s.** It is the maximum speed of the Assist mode, the mode the manual calls the safest. Assist-Sport
  (2 m/s) would be the upper bound and sits exactly at the maximum safe frontal collision speed (2 m/s), so it leaves no
  margin.
- **Ambient limit 50 °C.** The drone does not enter a room whose detectors read 50 °C or more. Two caveats the figure
  hides: the 0 to 50 °C range holds for batteries pre-conditioned between 10 and 40 °C (the battery's own operating
  range is 10 to 40 °C, Batteries Technical Specifications, p.2), and the high-capacity battery lowers the limit to 35 to
  40 °C with the UT or RAD payloads (p.3 and p.4). Neither applies to the configuration modelled (standard battery,
  inspection camera, LiDAR), but a different payload would need a lower value.

### Other figures of the same block (not from a datasheet)

- `viewRadiusM` 7 m, `thermalNoiseSdC` 3 °C, `batteryReservePct` 25 %: team assumptions, to validate.
- Thermal camera facts the assumptions lean on: Lepton 3.5, 160 × 120 px, 9 fps, sensitivity ≤ 50 mK, accuracy "from ±5 °C
  or ±5 %" (Technical Specifications v1.1, p.3); field of view 56° × 42° and scene range −10 °C to 140 °C of the same
  module (Elios 2 RAD User Manual v1.2, p.16: the Elios 3 sheet does not print them). A 3 °C standard deviation is of the
  order of the printed accuracy, it is not derived from it.

### What was corrected on 2026-11-22

The first values (10 min, 2 m/s, 50 °C) came from reseller copies of the sheets. Checked against the manufacturer's files:
50 °C is confirmed; **10 min** is in no Elios 3 document (now 9 min); the old citation of **2 m/s** was the maximum safe
collision speed, not a cruise speed (now the Assist maximum, 1.5 m/s). The Elios 2 figures that the first source also
quoted ("up to 10 min") were not found in a manufacturer file; the only Elios 2 flight time read from one is "up to
9 min with RAD payload" (Elios 2 RAD User Manual v1.2, p.15). The Elios 2 is no longer used as a reference.

### Documents read (all public; SHA-256 of the files as downloaded on 2026-11-22)

| Document | SHA-256 |
|---|---|
| Elios 3 Technical Specifications v1.1 (4 pages) | `3a2a4ff72963ea05f084b2dd9c09c0904e38397916de72b1298782e5f91b2948` |
| Elios 3 Batteries Technical Specifications, Standard and High-Capacity (4 pages) | `6ace75e3e17263c83d31c40cadf39bc89c029c1873e00e6377e5efdba1b70a3b` |
| Elios 3 User Manual v1.3 (92 pages) | `56ffc06aabb1edaf5ba4ef614b305e958e9560a24ce36a4de9e70b4ed75f7721` |
| Elios 3 RAD User Manual v1.0, 25.07.2023 (consulted; payload-specific figures, not used: 7 min 30 s with LiDAR, 45 °C) | `078b71416b0c18bb496574bbe53f6911f7225c1ad7d7c62864ba20142e6b75b0` |
| Elios 2 RAD User Manual v1.2, 24.02.2022 (consulted; thermal camera field of view only) | `c735a26e179647ebb0fa05fcd491444f11d6d53252c81138569d8c211a6b6394` |

Direct links. The three Elios 3 files are downloaded from the documentation page above (their file names are those of that page); their direct addresses carry a download token that the host rotates, so they are not copied here, and the SHA-256 above identifies the exact file read:

- https://www.flyability.com/hubfs/Knowledge%20Base%20Files/Documents/Manuals/E3%20and%20equipments/Elios%203%20RAD%20User%20Manual%20v1.0.pdf
- https://www.flyability.com/hubfs/ELIOS%202%20RAD%20user%20manual%20v1.2.pdf

Not read: the manufacturer's web pages quoting "up to 12 minutes" and "17 minutes with the high-capacity battery"
(consistent with the battery sheet: 12 min 30 s and 17 min, p.3). Page numbers are the position in the PDF; in the user
manual they are also the printed "Page n of 92".
