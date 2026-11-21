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
