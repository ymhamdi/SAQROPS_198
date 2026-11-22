# HUD, tablet and copilot: design notes

Impeccable review of the walk views on `feat/hud-design`: `app/src/panels/Hud.tsx`, `app/src/panels/Tablet.tsx`, the copilot (`app/src/copilot/CopilotCard.tsx`, `PushToTalk.tsx`, `Copilot.tsx`, `copilot.css`) and the alert lists (`stats/live.ts`, the HUD and tablet warnings).

The brief is in `PRODUCT.md` (Accessibility & Inclusion and Brand Commitments are binding). It reads in under 1 second for a gloved, tired crew with glare. Red = warning and amber = caution, always icon + word + colour. One warning takes over at a time. Tablet targets are at least 64 px. The look is mission-grade (aviation HUD, NASA SUITS), not sci-fi.

## Method

- **Critique** (`/impeccable critique`). Two isolated assessments, combined only afterwards:
  - **A:** a design review against the Impeccable rubric (Nielsen heuristics, cognitive load, personas).
  - **B:** the deterministic detector on the five source files, and the in-page overlay in headless Edge on the HUD and the tablet.
- **Audit** (`/impeccable audit`). Measured in the running app with headless Edge:
  - rendered touch-target sizes;
  - every text run's font size and WCAG contrast on its backing;
  - motion rules;
  - plus the detector's findings.
- **Evidence:** before screenshots in `docs/hud-before/`, 13 states. They show the HUD normal, low-O₂ and storm, the copilot idle, listening, thinking, speaking, GO, PARTIAL and NO-GO, the rules fallback, and the tablet.

## Scores (before)

### Critique: Nielsen heuristics (Assessment A), 24/40, Acceptable

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | The HUD alerts are the plan's static reasons, not live warnings. The copilot thinking and speaking states change only a 13 px line. Rules mode shows in 12 px text. |
| 2 | Match with the real world | 2 | "qwen3:8b … Ollama", "LLM wording" and "llm 0.6 s" sit on the visor. "Point of no return passed" reads as present tense next to a 45 min margin. |
| 3 | User control and freedom | 3 | Exit, Esc, dismiss and an explicit Apply all work. But Esc during an abort drops the abort, and "Cancel abort" is one unconfirmed click. |
| 4 | Consistency and standards | 2 | The same quantity is called "Walk-home margin" and "Point of no return" and differs by 1 min. Two ambers and two reds. Different O₂ thresholds on the HUD and the tablet. |
| 5 | Error prevention | 3 | Numbers come only from the engine and Apply is explicit. But the biggest symbol points straight-line across the sand, not along the route. |
| 6 | Recognition rather than recall | 2 | Three time bases (T+, unlabelled Mars local, UTC). Nothing shows what the copilot can answer, or that "confirm" applies an answer. |
| 7 | Flexibility and efficiency | 3 | Voice or typing, space-bar push-to-talk, voice confirm. No direct shortcut for Abort. |
| 8 | Aesthetic and minimalist design | 2 | The dock adds 5 controls, a model string and timing, and an answer card adds about 12 more items. A radial gradient and a pulsing red glow break the no-gradient, no-glow commitment. |
| 9 | Error recognition and recovery | 3 | Plain microphone errors, and an identical card in rules mode. But errors use the warning red, and "No walkable way to a safe haven" gives no next step. |
| 10 | Help and documentation | 2 | Help lives in hover tooltips, which don't exist under a glove or on a visor. No visible list of what can be asked. |

### Audit, 10/20, Acceptable

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | Severity is shown by colour alone. The MODELED badge is 3.1:1 at 10.5 px on the dark card (WCAG 1.4.3). No-go alerts are announced only `polite`. |
| 2 | Performance | 3 | Fine. Two continuous animations (push-to-talk halo, crew-dot pulse), both covered by reduced motion. |
| 3 | Theming | 2 | Tokens exist, but the HUD is full of hard-coded `rgba(255,255,255,x)`. Two ambers (`--amber` and `--hud-amber`) and two reds. Google blue pills on the visor. |
| 4 | Responsive | 1 | HUD: 10 of 13 controls are under 44 px (slider 16 px, select 33, Play 34, Abort 34, dismiss 32, checkboxes 18). Tablet: 15 of 15 are under the 64 px glove target. The dock overlaps the gauges at 1440 px and covers them at 960 px. |
| 5 | Implementation integrity | 2 | Detector: 1 low-contrast, 1 straggler, and the design hook's side-tab border (`copilot.css:131`). Plan-time reasons are presented as live alerts. The "SIMULATED" drill is unlabelled. |

## Design-specificity verdict

The data model is written for this product. The gauges are walk-home margin, not distance. The abort arrow follows the escape path. Copilot numbers come from the engine.

The visual layer is borrowed. It is the planner's Google Maps palette in dark mode: a turn-by-turn app with a big compass, three stat tiles and a chat widget. In the first two seconds a judge sees "a night-mode nav app with a chatbot", not mission software.

**Detector (B):**
- **CLI:** clean on all five files.
- **Overlay:**
  - 7 findings on the HUD state. Five are 10.5 px planner badges hidden under the HUD (false positives here). The real ones are the MODELED badge at 3.1:1 and a one-word last line in the answer text.
  - 1 finding on the tablet: flat heading scale, partly computed from the hidden planner `h1`.
- **Design hook:** flagged the 6 px side-tab border on the answer card.

## Ranked findings (worst first)

1. **[P0] HUD warnings are not live, carry no icon or word, have no takeover, and can be covered.**
   - The HUD lists `verdict.reasons` from planning time; the live warnings (`stats/live.ts`) only reach the tablet.
   - Alerts are colour plus a 130-character sentence at 15 px, below 34 px gauges. They all stack.
   - The copilot dock overlaps them (02).
   - At the most dangerous moment, "Point of no return passed" (red) sits next to an amber 45 min margin.
   - *Fix:* one fixed alert slot fed by the live warnings, then plan no-go, then cautions. A live warning takes over the visor: a band with icon + "WARNING" + an imperative of at most 6 words. Cautions get icon + "CAUTION". Others show as "+N more". The copilot answer hides during a takeover. *Commands:* harden, clarify.
2. **[P1] The storm drill is not labelled SIMULATED.**
   - A red radiation alert with no drill marker (03), on the HUD or the tablet. `StatusBadge` can't even show SIMULATED.
   - *Fix:* a SIMULATED badge with a treatment no other status uses, a "DRILL" tag on the alert, and a permanent "Simulated storm drill" corner tag while it is on. *Command:* clarify.
3. **[P1] Copilot states borrow the warning colour and differ only by small text.**
   - Listening is a red fill with an endless red halo (05).
   - Thinking dims the button to 50 % (06). Speaking looks like idle (07).
   - Errors use the alert red.
   - *Fix:* a copilot colour that is not a warning colour. The state word and glyph go on the button and change shape per state: HOLD TO TALK, LISTENING (with a mic-driven level), WORKING, SPEAKING, NOT HEARD. No halo. *Command:* quieter.
4. **[P1] The dock and answer card crowd the visor.**
   - The dock reserves no space: Ask touches the O₂ value (01), and it covers the gauges at ≤ 960 px.
   - The card is about 420×355 px with about 12 items, and the sentence repeats the headline.
   - The visor shows settings and developer telemetry: model name, checkboxes, "llm 0.6 s".
   - *Fix:* give the dock its own slot (bottom-right). The card reads verdict word → big number → limit in plain words → head-back time → Apply / Confirm → the question, small. Typing and settings go behind one control. Telemetry is off the visor. *Commands:* distill, layout.
5. **[P1] Tablet targets miss the 64 px glove spec, and the copilot covers the crew dot.**
   - Buttons are 52 px, dismiss 32, slider 28, checkboxes about 13. Clarify options can't be tapped. Gaps are 6–10 px.
   - The answer card covers the crew position (13).
   - *Fix:* every target at least 64 px with gaps of 16 px or more. Checkboxes become toggle buttons, clarify options become buttons, Abort is filled. *Command:* adapt.
6. **[P1] Legibility over terrain was never tested.**
   - The HUD is prototyped on an opaque radial gradient (a "no gradients" break). Labels at 60 % white and a compass ring at 35 % would wash out over bright regolith.
   - *Fix:* composite the HUD over the real Curiosity Navcam frame nearest the crew, labelled OBSERVED. Every slot sits on a dark backing plate, with full-opacity text at 4.5:1 or better against the brightest terrain. *Commands:* typeset, polish.
7. **[P2] The centre of the visor is occupied, and the arrow points straight-line.**
   - A 320 px compass fills the centre and points across the hollows.
   - *Fix:* keep the centre clear. Put the next stop, the route-following bearing (path look-ahead, as abort already does) and the along-route distance in a corner slot. At a stop, show "Leave in N min" instead of "—". *Command:* layout.
8. **[P2] One quantity, two names; three time bases.**
   - *Fix:* call it "Point of no return" everywhere, with the value "in 4 h 16". Mark clock times as Mars local, and keep T+ for the EVA clock only. *Command:* clarify.
9. **[P2] Theming drift.**
   - Hard-coded alpha whites, duplicate ambers and reds, and Google blue on the visor.
   - *Fix:* visor tokens (`--visor-*`) and one caution and one warning colour for both views. *Command:* polish.
10. **[P3] Small things.**
    - The italic question echo, the clipped placeholder, the GO chip on informational answers, and "All clear" next to a plan caution.
    - The walk end shows a dash instead of a closing figure, and "Past the limit" vs "Past limit".
    - The continuous crew-dot pulse.

## Persona red flags (short)

- **EV1, suited mid-walk:**
  - The largest symbol leads off the ridge route.
  - Labels at 60 % white wash out over terrain.
  - Alerts are 130-character sentences.
  - Push-to-talk flashes red on every question.
  - Abort is a 34 px pill among the demo controls.
- **Judge, 2-minute video:**
  - "numbers from the planner's engine" is 12 px at 64 % opacity.
  - The unlabelled drill contradicts "every value is labelled".
  - The Ask button overlaps the O₂ value.
- **Accessibility:**
  - Colour-only severity.
  - A 3:1 MODELED badge.
  - No-go announced politely.
  - Push-to-talk can't be triggered with Enter.

## Questions

Skipped: the brief says to fix the findings worst first without waiting.

## After

After screenshots of the same 13 states are in `docs/hud-after/`.

### What changed, by finding

1. **Alerts (P0).**
   - A new shared alert slot (`ui/AlertSlot.tsx` and `ui/alerts.ts`, unit-tested) is used by the HUD and the tablet, and drone or storm feeds can reuse it.
   - It is fed by the live warnings, then plan no-go, then cautions. Plan reasons that a live alert already covers are dropped.
   - Only the first alert shows; the rest are counted as "+N more".
   - A live warning takes over: a solid red band with an octagon icon, the word WARNING, a short title and an imperative ("Take shelter now", "Turn back now").
   - Cautions use a triangle and the word CAUTION. Gauges in caution or warning carry the word as well as the colour.
   - The copilot answer hides during a takeover.
   - The HUD now gets the live conditions (2 added props in `App.tsx`).
2. **SIMULATED drill (P1).**
   - A new SIMULATED badge with a double border, a treatment no measured value uses.
   - It shows on the storm alert, as a "Storm drill" tag in the clock slot and on the tablet, and on copilot answers limited by the drill.
3. **Copilot states (P1).**
   - The copilot has its own colour, a light blue that is never used for warning or caution.
   - The push-to-talk button carries a glyph, a word and a shape per state:
     - HOLD TO TALK: outline;
     - LISTENING: filled, with a record glyph;
     - WORKING: dashed outline;
     - SPEAKING: double outline;
     - VOICE OFF / NO ANSWER: grey.
   - The red halo and its loop are gone, and errors are no longer in warning red.
   - Rules mode and typed-only mode are stated in words with an icon.
4. **Dock and answer card (P1).**
   - The copilot owns the bottom-right slot and no longer overlaps the gauges.
   - The answer card reads: verdict word with its icon (✓ YES, ◐ PARTLY, ✕ NO; "Time left" and "Way home" for informational questions), then the big number, then "Limit: …" in plain words, then "Head back by 16:35 Mars local · in 15 min", then Apply / "or say confirm". The question is small at the bottom, stamped "at T+1:54", with its badge.
   - The 6 px side stripe the design hook flagged is removed.
   - The typed box is behind a "Type" button. The model name, checkboxes and timing are off the visor (timing is in the card's tooltip and the console).
5. **Tablet gloves (P1).**
   - Every target is at least 64 px, with 16 px gaps:
     - Exit, Play, speed, Abort;
     - "Follow crew", now a toggle button instead of a checkbox;
     - the slider row, now 64 px tall;
     - the Ask button and the input.
   - Push-to-talk is 96 px tall. Abort is filled red. Clarify options are buttons.
   - The answer column is narrow enough to leave the crew dot at the centre of the map visible.
6. **Legibility over terrain (P1).**
   - The HUD is composited over the real Curiosity Navcam frame nearest the next stop, facing the route where possible. It is credited and badged OBSERVED as a stand-in for the view.
   - Every slot sits on a dark backing plate. Text is solid with no alpha whites, and the radial gradients are gone.
7. **Clear centre and the route (P2).**
   - The 320 px compass is gone. The route slot (top left) has a small bearing dial that follows the route 15 cells ahead (as abort already did) and the distance along the route.
   - At a stop it shows "3 min until you leave this stop". At the end of the walk it shows the O₂ left on return.
8. **Names and time bases (P2).**
   - "Point of no return in …" everywhere, on the HUD, the tablet and the copilot.
   - Clock times say "Mars local". T+ is used for the EVA clock only.
9. **Theming (P2).**
   - New `--visor-*` tokens, with one caution colour and one warning colour on the visor.
10. **Small things (P3).**
    - No italic question. Informational answers have no GO chip. "Plan notes" are separate from "Right now". Push-to-talk also works with Enter.

### Measured after

- **CLI detector:** 0 findings on Hud, Tablet, Copilot, CopilotCard, PushToTalk and AlertSlot (exit 0).
- **Design hook:** no findings on the changed files.
- **Rendered (headless Edge):**
  - HUD: 0 of 11 controls under 44 px (before: 10 of 13), smallest text 12 px (before: 10.5 px), 0 text runs below WCAG AA.
  - Tablet: 0 of 13 controls under 64 px (before: 15 of 15), smallest text 12 px, 0 text runs below AA.
- **Audit re-score: 16/20, Good** (before 10/20).
  - Accessibility 3: words and icons on every severity; assertive warnings; badges readable.
  - Performance 3.
  - Theming 3: visor tokens; the planner still on its own palette.
  - Responsive 3: every target size met; very narrow visors stack.
  - Implementation integrity 4: detector clean; live alerts; SIMULATED labelled.
- **Critique:** not re-scored with a new dual assessment in this pass (it needs a fresh A/B run). Re-run `/impeccable critique app/src/panels/Hud.tsx` to compare against 24/40.

### Remaining issues

- **No partner (EV2) position:** the engine has no partner telemetry (the crew walks together), so none is shown rather than inventing it.
- **No heading-up view:** the bearing dial is north-up; there is no device heading to make it heading-up.
- **"+N more" is a count only:** the full list is on the tablet.
- **Backdrop coverage:** it exists only near stops that have Navcam frames (all 7 science stops do). Between far stops, or near via points, it falls back to the flat dark visor.
- **Planner untouched:** the planner (habitat view) is out of scope and keeps its Google-Maps palette, which is intended for that view.
- **Abort mode only restyled:** the mid-abort Esc still exits the whole HUD.
