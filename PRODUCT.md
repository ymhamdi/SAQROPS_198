# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **COS (commandant des opérations de secours), Protection civile tunisienne:** runs the intervention from the
  command post next to the engine, on a laptop or a large screen. Decides whether a team goes in, where it goes, and
  when it comes out. Primary user of the PC view.
- **Chef de binôme:** leads the two-firefighter team inside the burning building, with a tablet strapped on and
  gloves on, in smoke and heat. Reads the verdict, the next point, the air left and the PC's messages.
- **Porteur ARI:** wears the breathing-apparatus mask; sees a HUD that must read in under one second.
- **Challenge jury (Tunisian Aeroday Aero-Entrepreneur, with the Protection civile and INJAZ):** meets the product
  through a 1-minute demo video, a 5-minute pitch and questions. Some jurors are Protection civile officers who know
  the job; the screen must read as a credible operational tool, not a game or a sci-fi dashboard.

All four audiences are equal priority for the PC view; the crew views serve the firefighters first.

## Product Purpose

PNR · Point de Non-Retour is a decision aid for a fire on an industrial site. At every moment it tells the COS and the
team leader whether the engagement is still tenable, which way out, and why: a GO / NO-GO verdict, always with its
reasons, and « Décision : COS » because the decision belongs to the COS. Success: the COS sees a flashover coming
before the detectors give up, gets the team out above the breathing-apparatus whistle, and can explain why.

## Positioning

- Predicts a room's flashover 30 to 60 s ahead from the building's ordinary heat detectors, including after they fail
  above 150 °C (the NIST P-Flash approach), with an XGBoost model evaluated in the browser.
- Computes a point of no return on the team's air at every step of the route (exit before the EN 137 whistle, way back
  counted 1.5× slower), carried over from Martian Map's oxygen point of no return.
- A simulated reconnaissance drone flies round the building, outside the smoke plume, with the same point-of-no-return
  logic on its battery.
- Every number shows how it was obtained: OBSERVED, DERIVED, MODELED, SIMULATED or MOCK.

## Operating Context

- Command post (PC du COS) at the engine: one screen with the site plan, the verdict, the team's air, the drone, the
  objectives, the rooms and the log. The COS starts the demo fire, opens or closes doors, engages the team, removes
  objectives, orders evacuation and is the only one who can re-engage after a NO-GO.
- Team leader's tablet and mask HUD in two other windows of the same browser, linked live (standing in for the radio).
- Printable A4 reflex card for the team.
- Demo site: a fictional 60 × 40 m composite-parts workshop (offices, main switchboard, Li-ion charging room, solvent
  store, paint booth, production hall with autoclave). The fire, detector readings and drone flight are simulated and
  played at ×10 or ×20 for the video.
- Seen in a screen recording at about 1600 px wide, on a projector during the pitch, and live on a laptop.

## Capabilities and Constraints

- Static web app: Vite, React, TypeScript; the plan is drawn on a canvas; the simulation runs in a Web Worker; no
  backend, no database, no authentication, no LLM, no 3D, one floor.
- No new UI library. Interface in French; code and commits in English.
- Safety rules, each with a test: the AI can only make a verdict worse; « Décision : COS » on the PC, tablet and card,
  the HUD stays short; every number carries its status badge and SIMULATED or MOCK never looks OBSERVED; every
  assumption lives in data/config.json with its source; the verdict reads detectors only, never the simulator's truth or
  the drone's thermal image; a NO-GO is latched until the COS re-engages; the drone keeps its battery reserve, refuses
  high wind and stays out of the plume.
- Terms: COS, binôme, chef de binôme, ARI, sifflet, point de non-retour (PNR), embrasement, engin (FPT), TGBT, PC,
  « Ré-engager (décision COS) », vérité simulateur.

## Brand Commitments

- Name: « PNR · Point de Non-Retour ». No logo, colours or typeface fixed beyond the current build.
- No real company named on the site. No Protection civile, Aeroday or INJAZ logo or wording that implies an
  endorsement: the Protection civile is the challenge's partner, not a customer.
- The visual world of the PC is to be replaced (decided 21 Nov, paused): dark operations room, SITAC direction chosen.

## Evidence on Hand

- Real: the outdoor wind at the site's coordinates from Open-Meteo (DERIVED, data/weather/open-meteo.json); published
  fire-engineering correlations and standards, cited in data/SOURCES.md.
- Model: XGBoost v1 trained on 5 000 scenarios of the team's own engine (MODELED); NIST P-Flash data planned when
  data.nist.gov is reachable; UL FSRI full-scale tests (OBSERVED) planned for validation.
- Everything shown in the demo (fire, readings, team position, drone flight, roof thermal image) is SIMULATED or MOCK.
- No real intervention, user, testimonial, Protection civile validation or partner endorsement exists; none may be
  implied. Reflex instructions are paraphrases of public references still to be validated by the Protection civile.

## Product Principles

1. Safety reads first: a verdict always comes with its reasons, and the most dangerous fact is the most visible.
2. The decision stays with the COS: the tool advises, never commands.
3. Honest provenance: every number shows how it was obtained; simulated never passes for measured.
4. Detectors are the truth the tool may use: what the simulator knows, the verdict does not.
5. Calm under load: a COS mid-intervention, a team leader in smoke, or a juror in a one-minute video must not hunt.

## Accessibility & Inclusion

- Legibility at a distance (command-post screen, projector) and in a compressed demo video is a practical requirement.
- The HUD is read in under one second through a mask: one primary number per slot, nothing thin, one warning at a time.
- Red = warning (act now), amber = caution (watch). Never colour alone: always icon + word + colour.
- The tablet is used with gloves: touch targets of at least 64 px with generous spacing.
- Motion only for state changes and new alerts, and it respects prefers-reduced-motion.
- Status badges (OBSERVED / DERIVED / MODELED / SIMULATED / MOCK) stay visible and distinct.
