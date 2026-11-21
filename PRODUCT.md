# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Astronaut crew (persona the tool is built for):** two suited astronauts plus a support rover on a Marswalk through the Mount Sharp boxwork, Gale Crater. They plan in the habitat on a large screen, carry a tablet on the walk, and see a helmet-visor HUD.
- **NASA Space Apps 2026 judges:** they meet the product through a 2-3 minute demo video and a live demo. The screen must read as credible mission software an astronaut could actually use, and land its point within that demo.

Both audiences are confirmed as equal priority.

## Product Purpose

"Google Maps directions for one Marswalk." A hyperlocal route planner for the few square kilometres one crew covers on one excursion, at metre resolution. It plans a walk that stays on the boxwork ridges, avoids the sandy hollows, reaches the science stops, and always keeps the walk home inside the O2 budget. Success: a crew (or a judge) can see the route, the stops, and a GO / NO-GO verdict with its reasons, and trust where every number comes from.

## Positioning

Mars Trek and the USGS geologic maps work at global and regional scale. This works at the scale of one walk: suit-speed walking times (Tobler's function × suit factor), a walk-home field from every cell, and a point-of-no-return check against O2. Every value is labelled OBSERVED, DERIVED, MODELED or MOCK.

## Operating Context

- Habitat planning view first (large screen): build and compare routes, review conditions, assign tasks. Tablet view and HUD view come later from the same data.
- Site: boxwork on the sulfate-bearing unit of Mount Sharp, Gale Crater. Ridges 1-2 m tall, ~5 m wide, sandy hollows between.
- Map base: real MRO HiRISE imagery via NASA Mars Trek. The site data is built from real NASA/USGS sources (see Evidence on Hand). The weather is Curiosity REMS for one sol (MODELED as a forecast).
- On the walk, the crew carry a tablet and see a helmet-visor HUD. A voice copilot in both answers what-if questions spoken mid-walk ("Can we stay 20 more minutes?").
- Hackathon: Nov 14-15, 2026.

## Capabilities and Constraints

- Static web app (Vite + React + TypeScript + Leaflet). Route engine (A*, walk-home Dijkstra) runs in a Web Worker on a 1000 x 1000 grid at 2 m cells.
- Optional local copilot server (`server/`: FastAPI, Ollama qwen3:8b, faster-whisper on the CPU) on the same laptop, offline. The app works without it: typed questions, rule parser and fixed answer templates. The LLM only interprets words; every number comes from the route engine.
- Built today: layer toggles and opacity, slope / terrain overlay, click to add stops (science targets or via points), route coloured by hazard, GO / NO-GO panel with reasons, stations table with arrival times, EVA line strip, Mars24 clock, saved plans and plan links, a printable card. On the walk: the tablet view with live warnings, the helmet HUD with abort, the simulated solar-storm drill, and the voice what-if copilot (stay longer, add or skip a stop, time left, way home).
- Terms: Marswalk, EVA, habitat, support rover, science stop, via point, walk-home, point of no return, sol, LMST/LTST, Ls.
- Data statuses must be visible in the UI; MOCK or MODELED is never presented as OBSERVED.

## Brand Commitments

Name "Martian Map". No logo, colours or team name fixed yet.

The walk views (HUD, tablet, copilot) must read as mission-grade, calm and legible, like aviation HUD symbology and NASA spacesuit display concepts (NASA SUITS). They must not read as a sci-fi dashboard: no neon glows, gradients, decorative motion or cards inside cards.

## Evidence on Hand

- Real: MRO HiRISE Curiosity roving-site mosaic tiles (Mars Trek). The USGS MSL Gale Merged DEM (terrain grid and slope). The Curiosity boxwork-campaign stops from the MMGIS traverse (science targets, DERIVED). Sand and boulders mapped from the HiRISE orthophoto (MODELED). Curiosity raw images at the stops (OBSERVED). THEMIS night infrared. Curiosity REMS weather for sol 4718. The Mars24 algorithm, verified against NASA GISS worked examples.
- MODELED by team rules: the habitat placement, the suit and walking assumptions, the safety thresholds. The solar-storm drill is SIMULATED.
- No real crew, mission, testimonials or partner endorsements exist; none may be implied.

## Product Principles

1. Safety reads first: a verdict always comes with its reasons.
2. Honest provenance: every number shows how it was obtained.
3. Hyperlocal over global: metre-scale detail of one walk beats planet-wide breadth.
4. Calm under load: an astronaut in a suit, or a judge in a 2-minute demo, must not have to hunt.

## Accessibility & Inclusion

- Legibility at a distance (habitat screen) and in a demo video is a practical requirement.
- The HUD is read in under 1 second by a tired, suited crew, with glare and bright dusty terrain behind a transparent visor. One primary number per slot, nothing thin. The visor is see-through: no filled panels, only text, icons and thin strokes, each with a tight dark halo so it reads over bright sand and dark rock.
- Red = warning (act now), amber = caution (watch). Never colour alone: always icon + word + colour. Only one warning takes over the visor at a time.
- The tablet is used with gloves: touch targets at least 64 px with generous spacing.
- Motion only for state changes and new alerts, and it respects `prefers-reduced-motion`.
- Data statuses (OBSERVED / DERIVED / MODELED / MOCK / SIMULATED) stay visible. SIMULATED or MOCK never looks OBSERVED.
