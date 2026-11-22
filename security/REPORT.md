# Security audit report: PNR (SAQROPS_198)

## 1. Run

- **Profile:** quick, whole repository. **A partial pass:** one hunter wave, one final coverage critic, one independent verifier per lead. Not complete coverage; 6 units are deferred (section 7).
- **Source ref:** main at `c91771c` (frozen copy on branch `security`). Reconnaissance ran earlier, on `20d0cdc`; main then received the hardware link, firmware and copilot (PR #2, PR #3). The parent mapped that delta from the diff and added four units; every hunter then read the frozen copy at `c91771c`.
- **Execution:** source review only. This Windows host has no OS-enforced sandbox (no WSL, no container runtime), so no target code was executed and nothing was fetched. Every lead that would need a local test stays `needs_validation`; no record can be `confirmed`.
- **Budget:** none set. Agents spent: 4 reconnaissance, 8 hunters, 1 critic, 12 verifiers (25 runs; six hunters were interrupted by an account usage limit and resumed with their saved context).
- **Prior runs:** none. This is the first run for this repository.
- **Deviations from the skill, disclosed:** (1) the two validators are patched copies (`tools/`) because Windows has no O_NOFOLLOW or O_NONBLOCK; the patch rejects symlinks with lstat; the audited files are written by the parent. (2) Hunter and verifier prompts were assembled verbatim from the skill files and handed over as files to read. (3) The final critic returned the hardware unit for reassignment; under the quick profile it is deferred, so two verified leads are linked to it only through its archived attempt. (4) Two agents' result files were transcribed by the parent from their completion messages. (5) One reconnaissance agent ran a stray no-op interpreter command; no project code ran.

## 2. Security posture

PNR is a static, client-only simulation aid with no server, account, database or network egress in `app/src`; React escapes every rendered string and the source has no `innerHTML`, `eval`, storage use or file path sink. The classic web, secrets and supply-chain classes came back clean (section 6). The material risk is **integrity of the safety logic**, not data theft: the product's own rules (R1 to R13) are enforced in the sending worker only, and the review found one rule (R13 recall) whose invariant depends on event order, plus several consistency gaps. Of 12 leads, 4 survive as `needs_validation` and 8 were refuted by an independent verifier; none is a confirmed vulnerability.

## 3. Confirmed findings

None. No record could be confirmed in this run (no bounded local result could be observed). This is not a statement that the code has no defect: see sections 4 and 5.

## 4. Needs validation (no severity assigned)

| # | Lead | Boundary | Blocker |
|---|---|---|---|
| 1 | A team engaged while a NO-GO is already latched is never recalled, not even by a MAYDAY | app/src/panels/Pc.tsx:185 to app/src/sim/sim.ts:378 | No target code could be run: this audit host has no OS-enforced sandbox (Windows 11, no WS... |
| 2 | Crew windows accept any snapshot on the shared BroadcastChannel, so a second master (self-playing demo window, or another PC tab) or a malformed snapshot overrides or breaks the displayed verdict | app/src/App.tsx:62 to app/src/App.tsx:51 | Target code cannot be executed in this run (no OS-enforced sandbox, no browser run), so th... |
| 3 | A critical-room entry keeps its first provenance label when a later REPLAY reading raises its value | app/src/hardware/serialManager.ts:126 to app/src/panels/HardwarePanel.tsx:157 | No OS-enforced sandbox exists on the audit host, so the pure-function result (status kept ... |
| 4 | Cylinder pressure is ignored after a simulation reset because the EventGate keeps its last ari value | app/src/hardware/serialManager.ts:122 to app/src/sim/sim.ts:408 | No target code may be executed on this audit host (no OS-enforced sandbox: Windows 11, no ... |

Full source traces, evidence, blockers and bounded local and owner-observed checks are in [NEEDS-VALIDATION.md](NEEDS-VALIDATION.md). In short:

- **Crew windows take any snapshot** (`client/live-channel-snapshot-no-producer-binding`). The tablet, HUD and twin show whichever same-origin window posted last on `pnr.live.v1`: a second PC tab or a `?view=...&demo=1` window becomes a second master, and a malformed snapshot unmounts the window (no error boundary). R1, R2 and R6 are enforced only in the sender.
- **No recall when engaged under a latched NO-GO** (`app/src/sim/sim.ts:judge:recall-edge-triggered-on-latch`). The automatic recall fires only on the transition into the latch. If a NO-GO is latched in standby (for example by a hardware critical room) and the COS then engages, a later MAYDAY does not recall the team, contrary to R13. Only the manual evacuation button does.
- **Cylinder pressure ignored after a reset** (`hw-eventgate-ari-memory-survives-sim-reset`). The EventGate keeps its last rounded `ari` value across a simulation reset, so a steady low reading is suppressed and the PNR follows the model as if the cylinder were full.
- **Provenance label** (`hw-critical-room-merge-keeps-first-provenance-status`). A REPLAY reading that raises a live-marked room's value is shown with the OBSERVED badge (R3).

## 5. Refuted by independent verification (not findings)

Eight leads were disproved by a verifier that did not hunt them. Several are real bugs worth fixing even though they cross no security boundary; they are listed because the owners will want them.

| Fingerprint | Why it is not a finding | Still worth fixing |
|---|---|---|
| `app/src/knowledge/known.ts:mergeKnowledge:expired-obstacle-reopens-passage` | Source refutes the claim in both cases. (1) Drone found the rack: the cells are on open hall floor and take the hall's room multiplier. The hall's room-thermal observation is taken at its first visit, normally the west entrance, a... | see hardening |
| `app/src/rehearsal/input.ts:knownInputOf:omits-hardware-aggravations` | The plan really does omit hardware, and a plan can read GO while the live verdict is NO-GO. Source and visible controls refute it as a security finding, because no meaningful impact crosses a boundary. (1) R13 as written holds on ... | see hardening |
| `app/src/sim/sim.ts:tick:team-out-without-exit` | The needed precondition, a blocked-passage set that cuts every exit or an objective, cannot be produced by any principal below the developer. Obstacle observations come only from site.hidden, which is bundled site data, restricted... | see hardening |
| `client/live-channel-copilot-message-unvalidated-on-pc` | Refuted by source and by missing boundary crossing. (a) The only way to post on pnr.live.v1 is script running in the app's own origin inside the PC's browser profile. BroadcastChannel is same-origin only. Source has no HTML or scr... | see hardening |
| `copilot-danger-local-omits-drone-and-hardware-aggravation` | Source refutes the claim as a security finding. (1) A visible control exists on the same screen. The tablet shows the NO-GO headline naming the hardware-critical room with 'Décision : COS' (Tablet.tsx:57-60, verdict.ts:60-64) and ... | see hardening |
| `drone/wind-gate-fails-open-on-nonfinite-or-missing-wind` | Source refutes a security finding. (1) No attacker-reachable input: the wind is a static JSON file bundled at build time and read once in makeContext. The app has no network call, and the worker, BroadcastChannel and hardware path... | see hardening |
| `hw-replay-origin-self-declared-real-measurement-banner` | Rejected: the behaviour is real, but there is no security finding. (1) It is deliberate and tested: replay.ts:87-89 and replay.test.ts:112-123 say that a file's own origin field decides the banner, and files without it fall back t... | see hardening |
| `sim/validatePlan-drops-unreachable-objectives-live-no-path` | Source refutes the live-GO claim. The rehearsal and the live simulation share the same known.blockedCells, objectives and entry. Unreachability is symmetric connectivity on the same grid (route/search.ts, route/cost.ts). The tick ... | see hardening |

## 6. Hardening notes and positive source patterns

Hardening (65 notes from the hunters, grouped; none is a vulnerability by itself):

- **CI:** add `permissions: contents: read`, `persist-credentials: false` on both checkouts, and pin actions to commit SHAs if secrets or publishing are ever added (.github/workflows/ci.yml).
- **Dependencies and data:** `leaflet` and `@types/leaflet` are declared but never imported; `ml/requirements.txt` has open `>=` ranges with no lock or hashes; `data/SOURCES.md` embeds three third-party download tokens (public manufacturer documents) and is shipped in `dist/data`; `ml/download.py` accepts a NIST file with no published checksum and clones the FSRI repository without a commit pin; the shipped model files carry no digest.
- **Wind and data validation:** `planFlight` compares `wind.speedMs > maxWindMs`, which is false for null or missing values; `fetch-weather.ts` writes the API values without a finite or range check; `xgb.ts leafValue` has no iteration bound or index check.
- **Channel and window robustness:** no schema check on `snap` or `copilot` messages, no root error boundary, no liveness indicator in the crew views; the PC keeps at most 50 copilot entries, so an unacknowledged MAYDAY can be pushed out of the alert after 50 exchanges and the tablet says "MAYDAY transmis" without a receipt.
- **Safety logic consistency:** engage and plan-validate are not gated on a closed latch; `reset` and `?demo=1` reopen the latch with no logged decision (the demo logs `by: 'COS'`); the 'out' state is inferred from the track, not from standing on an exit cell; expired obstacle observations carry no explicit cost; the rehearsal input slice does not carry the hardware state; the copilot's room answer is scoped to detectors and AI only.
- **Hardware link and firmware:** device-supplied room names are unbounded text shown in reasons, notes and copilot answers; the app accepts any sensor on any port; replay files have no size, entry or delay cap; the HUD alert channel is change-only with no acknowledgement or heartbeat, so a pulled cable leaves the mask on its last verdict; the `jury_demo.py` reader is unbounded and its exit handler forces GO on the HUD board; `binome_hud.ino` accepts unauthenticated alert and lcd commands (physical access is the boundary).
- **Copilot:** `checkWording` has no production caller and its number check is ASCII-only; the MAYDAY and engagement word lists are narrow and French-only; `checkGuess` skips the confidence check when confidence is absent.

Positive patterns: the npm lockfile pins every package with integrity from the npm registry; the CI workflow has no secrets, no privileged trigger and no expression injection; the dev data route resists traversal; the HUD firmware bounds every host-supplied buffer; hardware, drone and AI input can only add reasons to a verdict (guarded by throws in the merge functions); the copilot cannot reach any action or network sink and its LLM hook is dormant; no credential exists in the tree or in the history of any branch.

## 7. Coverage

Ledger: 20 units: 7 covered, 7 candidate (a lead was raised and independently decided), 0 blocked, 6 deferred. Final critic result: not clean (it accepted one missing unit and returned one unit for reassignment); under the quick profile these are recorded as deferred, not hunted.

**Covered** (no lead):
- .github/workflows/ci.yml#on -> .github/workflows/ci.yml#permissions (SUPPLY-CHAIN-AND-RELEASE.md#Untrusted code in a privileged workflow)
- app/package.json#dependencies -> app/package-lock.json#integrity (SUPPLY-CHAIN-AND-RELEASE.md#Dependency source and namespace confusion)
- app/src/ml/predict.ts#model-json-raw -> app/src/ml/xgb.ts#leafValue (ATTACK-CLASSES.md#Business logic)
- app/vite.config.ts#pnr-data -> app/vite.config.ts#PUBLIC_DATA (ATTACK-CLASSES.md#Resource and file handling)
- firmware/binome_hud/binome_hud.ino#serial-input -> firmware/tools/jury_demo.py#serial-reader (MEMORY-SAFETY-AND-BINARY.md#Out-of-bounds read or write)
- ml/download.py#main -> ml/download.py#sha256-verification (ATTACK-CLASSES.md#Resource and file handling)
- repository#all-tracked-files -> .gitignore#secrets (ATTACK-CLASSES.md#Obvious things)

**Candidate** (a lead was raised; decision in sections 4 and 5):
- app/src/App.tsx#location.search -> app/src/demo/useDemo.ts#useDemo (ATTACK-CLASSES.md#Access control)
- app/src/copilot/pipeline.ts#question -> app/src/copilot/guard.ts#checkWording (ATTACK-CLASSES.md#Injection)
- app/src/live/channel.ts#pnr.live.v1 -> app/src/App.tsx#CrewApp (CLIENT-SIDE.md#Cross-context storage and broadcast confusion)
- app/src/panels/HardwarePanel.tsx#replay-file-input -> app/src/hardware/replay.ts#parseReplayFile (ATTACK-CLASSES.md#Resource and file handling)
- app/src/sim/worker.ts#onmessage -> app/src/sim/actions.ts#applyAction (ATTACK-CLASSES.md#Business logic)
- data/weather/open-meteo.json#wind -> app/src/drone/drone.ts#maxWindMs (ATTACK-CLASSES.md#Business logic)
- repository#all-source -> app/src/sim/sim.ts#judge (ATTACK-CLASSES.md#Wildcard)

**Deferred, not reviewed in this run** (a later run or a scoped follow-up should take them):
- app/src/drone/indoor.ts#senseIndoor -> app/src/drone/indoor.ts#planIndoor (ATTACK-CLASSES.md#Business logic) — quick_profile_final_critic: hunter-wild: planner and sensor model behind R9/R10 not read
- app/src/hardware/serialManager.ts#web-serial-port -> app/src/hardware/protocol.ts#parseLine (PROTOCOLS-RPC-AND-MESSAGING.md#Untrusted producer treated as control plane) — quick_profile_final_critic: device-supplied room text into verdict reasons, notes and copilot answers, and snapshot growth, not closed in wave 1
- app/src/panels/Pc.tsx#drone-launch-button -> app/src/sim/sim.ts#detectedFire (ATTACK-CLASSES.md#Business logic) — quick_profile_final_critic: critic: R7 plume exclusion is computed once at launch and is null before detection
- app/src/scene/render.ts#render -> app/src/panels/Hud.tsx#Hud (ATTACK-CLASSES.md#Business logic) — quick_profile_final_critic: hunter-wild: HUD renderer is the only barrier to rooms[].truth (R5) in the crew windows
- app/src/sim/client.ts#pump -> app/src/hardware/gate.ts#pass (RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Core discipline) — quick_profile_final_critic: hunter-hw: device-rate event flood starves simulation ticks; single-user availability
- firmware/README.md#arduino-cli-toolchain -> firmware/README.md#pinned-versions (SUPPLY-CHAIN-AND-RELEASE.md#Mutable and unbound build inputs) — quick_profile_final_critic: hunter-supply: firmware toolchain versions documented in prose only

Out of scope: other branches; the host environment (hosting headers, CSP, repository and branch protection settings), which cannot be established from source. The CVE status of locked npm dependencies was not checked (no network).
