# Needs validation

These leads are source-grounded and independently re-read, but a decisive fact could not be observed in this run: no OS-enforced sandbox exists on the audit host, so no target code ran. They carry no severity and are not confirmed vulnerabilities. Each plan is bounded and local; none asks for traffic to a deployed system.

## 1. A team engaged while a NO-GO is already latched is never recalled, not even by a MAYDAY

Fingerprint: `app/src/sim/sim.ts:judge:recall-edge-triggered-on-latch`

In judge(), the automatic recall of an engaged team (mode engaged to evacuating) fires only on the transition into the latch. A NO-GO can be latched while the team is in standby: a hardware critical room, a MAYDAY, a detector failure, or an AI prediction on an objective room. The COS can still press 'Engager sans répétition' or 'Valider le plan (décision COS)', because neither button checks the latch. After that, `before` is true on every judge() call. A later MAYDAY, a hardware critical room, a flashover prediction or an air-budget NO-GO adds reasons to the shown verdict, but the team stays 'engaged' on its objective route. The HUD word stays NO-GO, not SORTIE. R13 in CLAUDE.md (lines 46-47) says a MAYDAY forces NO-GO and recalls the team, and the comment above applyHardware says the team is recalled 'if it is in'. Only the manual 'Évacuation' button recalls it, or a COS re-engage, which clears the latch and re-arms the edge. Source-visible mitigations that bound the impact: the PC shows the latched NO-GO ('NO-GO maintenu'), the MAYDAY alert and an 'Évacuation' button, and engaging under a displayed NO-GO is a deliberate COS decision. Everything is simulated, so the effect is on the simulated team mode and on the HUD and tablet display. No test engages under an existing latch. The outcome below was derived by reading the source only; nothing was executed.

**Claimed root cause.** The recall condition is `!before && latch.latched && s.team.mode === 'engaged'` (edge-triggered), and engage() and validatePlan() do not refuse, or immediately recall, when s.latch.latched is already true. The invariant 'a NO-GO or MAYDAY recalls an engaged team' therefore depends on the order of events.

**Source trace.**
1. `entrypoint` app/src/panels/Pc.tsx:185 (PC button 'Engager sans répétition' (sends engage-direct)): In standby the button is disabled only when there are no objectives; it ignores s.latched. 'Valider le plan (décision COS)' (app/src/panels/PlanPanel.tsx:142) is disabled only by team.mode !== 'standby'. The worker applies the action through applyAction (app/src/sim/actions.ts) with no latch guard.
2. `propagation` app/src/sim/sim.ts:579 (engage() (also reached through engageWithoutRehearsal at line 588 and validatePlan at line 598)): Sets mode 'engaged', then calls replan() and judge() without checking s.latch.latched. replan() in engaged mode plans to the objectives.
3. `propagation` app/src/sim/sim.ts:373 (judge(): `const before = s.latch.latched`): `before` is already true, because the NO-GO was latched while in standby (for example applyHardware at line 418 with a critical room or a MAYDAY; hardwareSim.test.ts lines 42-47 and 104-109 show that this latches in standby).
4. `sink` app/src/sim/sim.ts:378 (judge() recall: `if (!before && latch.latched && s.team.mode === 'engaged')`): This is the only automatic move from engaged to evacuating on a NO-GO. It is skipped when the latch was already closed. A later MAYDAY (applyHardware, line 418, then judge) adds the HARDWARE_MAYDAY reason, and the mode stays 'engaged'. tick() only re-plans toward the objectives while the mode is engaged (line 469).

**Verified evidence.**
- app/src/sim/sim.ts:378: The recall is the only automatic place that sets mode 'evacuating' on a NO-GO, and it requires the latch to have just closed (!before).
- app/src/stats/latch.ts:33: applyLatch returns early when the latch is already closed: no new transition is signalled, which is why `before` is true on every later call.
- app/src/hardware/hardwareSim.test.ts:82: 'an engaged team is recalled' and the MAYDAY recall test (lines 92-100) call engage() first, with an open latch. No test engages under a latched NO-GO.
- CLAUDE.md:46: R13 (lines 46-47) states that a MAYDAY forces NO-GO and recalls the team, with no condition on the previous latch state.
- app/src/panels/Pc.tsx:189: Mitigation: while the team is engaged the PC shows an 'Évacuation' button (manual recall), and it shows the latched verdict and the 'Ré-engager' button at lines 132-136. This bounds the impact to a missing automatic recall.

**Blockers.**
- No target code could be run: this audit host has no OS-enforced sandbox (Windows 11, no WSL or container runtime), so the runtime result of the event order (latch in standby, then engage, then MAYDAY) is derived from source reading only and has not been observed.

**Bounded local check.** Run this only inside an OS-enforced sandbox with no network and writes limited to scratch. Copy app/src/hardware/hardwareSim.test.ts lines 1-36 (imports, site, fresh(), hot(), mayday(), send(), run()) into a scratch vitest file under app/src/sim. Then write one test. const { ctx, s } = fresh(); send(ctx, s, hot(solvents, 80)); expect(s.latch.latched).toBe(true); expect(s.team.mode).toBe('standby'); applyAction(ctx, s, { type: 'engage-direct' }); expect(s.team.mode).toBe('engaged'); send(ctx, s, mayday()); run(ctx, s, 5). Assert the NO-GO is shown and the HARDWARE_MAYDAY reason is present. Then assert s.team.mode === 'evacuating', which is what R13 requires. The prediction from source is that the mode stays 'engaged'. Repeat once with { type: 'plan-validate', plan } in place of engage-direct. Control: engage first, then send the MAYDAY. It recalls, as in hardwareSim.test.ts line 92. Run from app/ with `npx vitest run <scratch file>`. A result of 'evacuating' in the first case refutes the candidate.

**Owner-observed deployment check.** (none)

## 2. Crew windows accept any snapshot on the shared BroadcastChannel, so a second master (self-playing demo window, or another PC tab) or a malformed snapshot overrides or breaks the displayed verdict

Fingerprint: `client/live-channel-snapshot-no-producer-binding`

The tablet, HUD and twin windows treat every 'snap' message on BroadcastChannel 'pnr.live.v1' as the PC's state. They check no producer, epoch, sequence or shape. Any window of the app that runs useBroadcast is a master. That includes a second PC tab at '/', and a window opened with ?view=hud|tablet|twin&demo=1, which mounts DemoHost with its own self-playing simulation. A fresh master posts its first snapshot as soon as its worker resets (client.ts:63, 52). It also answers every 'hello' with its latest snapshot. Crew windows then show that master's verdict, air and route, or flip between two masters, and no crew view shows which master produced the data. R1, R2 and R6 are enforced only in the sending worker, so a crew window can show GO from the second master while the real PC is paused or latched at NO-GO. The PC ignores 'snap' messages (useBroadcast.ts:13), so the PC's own verdict is not affected. A null or malformed snapshot posted by same-origin script blanks the view (null) or throws in render (for example Hud.tsx:19 reads snap.shown.verdict, and Plan.tsx:117 reads snap.hardware.critical when the twin renders it). The repository has no error boundary, so React unmounts the crew window. A second master that a link or popup starts cannot choose the displayed content: it plays the scripted demo. The malformed-message variant needs script already running on the app's origin, which crosses no further boundary. Impact is limited to display integrity of a simulated aid within one browser profile. No real principal or data is involved, and the demo behaviour is documented in the DemoHost header. The source trace is complete and no control was found. The rendered result and the exact interleaving have not been observed because no target code could be executed in this run.

**Claimed root cause.** The live channel has no producer authentication, master arbitration or message-schema validation. Crew consumers treat any message with type 'snap' as the master's authoritative state and show no origin or liveness indicator. A second same-origin master, or a malformed message, therefore replaces or breaks the displayed verdict.

**Source trace.**
1. `entrypoint` app/src/App.tsx:62 (App): ?demo=1 is read from location.search. For a crew view, line 66 mounts DemoHost, an autonomous master. Opening '/' again (line 65, PcApp, useBroadcast at line 28) also starts a master.
2. `propagation` app/src/demo/DemoHost.tsx:23 (DemoHost): useBroadcast(sim.snap) posts every snapshot of the demo simulation on the shared channel. The header (lines 2-3) states that two masters would fight over it, and no code enforces this.
3. `propagation` app/src/live/useBroadcast.ts:13 (useBroadcast): Any master answers every 'hello' with its latest snapshot (line 13) and posts each snapshot change (line 20), with no master id, epoch or sequence.
4. `propagation` app/src/live/channel.ts:20 (openChannel): BroadcastChannel('pnr.live.v1') onmessage hands e.data to the handler with no sender, sequence or shape check.
5. `sink` app/src/App.tsx:51 (CrewApp): m.type === 'snap' && setSnap(m.snap): the last message wins and is rendered by Hud, Tablet and Twin as the live verdict (Hud.tsx:19 reads snap.shown.verdict).

**Verified evidence.**
- app/src/demo/DemoHost.tsx:3: Code comment: 'PC window: two masters would fight over the same channel.' It documents the limitation, and no code enforces it.
- app/src/sim/protocol.ts:31: The Snapshot interface has no producer id, epoch, sequence or demo marker, so a receiver cannot tell masters apart or detect staleness.
- app/src/panels/Hud.tsx:19: topAlert reads snap.shown.verdict with no shape or liveness check. app/src/main.tsx (lines 9-13) has no error boundary, and a grep of app/src finds no ErrorBoundary or onCaughtError, so a render throw unmounts the window.
- app/src/panels/Plan.tsx:117: Plan reads snap.hardware.critical unguarded. For channel data it is reached through Twin.tsx:197 (crew window). The PC renders its own worker snapshot (Pc.tsx:117) and ignores 'snap' messages, so this does not throw in the PC through the channel, which corrects the hunter's wording.
- app/src/sim/client.ts:63: useSim queues a 'reset' on mount and sets the first snapshot (line 52). A newly opened PC tab or demo window therefore posts a snapshot through useBroadcast as soon as it loads, before any playback.

**Blockers.**
- Target code cannot be executed in this run (no OS-enforced sandbox, no browser run), so the rendered result has not been observed. That covers a second master overriding or alternating with the real PC on the crew windows, and a null or malformed snapshot blanking or unmounting a crew window. The source path is complete, but the on-screen outcome is unobserved.
- Deployment facts are not visible in the repository: whether the deployed origin serves any other page that could post on the channel (relevant only to the malformed-message variant), and what response headers the hosting adds. The repository has no CSP, COOP or frame-ancestors configuration.

**Bounded local check.** In a disposable browser profile on the local dev origin, open the PC ('/') and a tablet ('?view=tablet'). Start playback and let the PC reach NO-GO, or pause it. (1) Open '/' in a second tab and record whether the tablet switches to that tab's fresh snapshot (t near 0, no NO-GO). (2) Open '?view=tablet&demo=1' in a third window and record whether the first tablet shows the demo's verdict or alternates every tick with the real PC. (3) From the console of one same-origin tab run new BroadcastChannel('pnr.live.v1').postMessage({type:'snap',snap:null}), then postMessage({type:'snap',snap:{}}). Record whether the HUD first shows the waiting screen and then unmounts with a TypeError. (4) From a page on a different origin in the same profile, call window.open of the app URL with ?view=hud&demo=1 after a click, and record whether the existing crew windows are overridden. Use only the local dev server and a disposable profile.

**Owner-observed deployment check.** Owner check, with no audit traffic sent: confirm whether any other page or application is served from the deployed application's origin, and which response headers the hosting adds (CSP, Cross-Origin-Opener-Policy, frame-ancestors). None is configured in the repository.

## 3. A critical-room entry keeps its first provenance label when a later REPLAY reading raises its value

Fingerprint: `hw-critical-room-merge-keeps-first-provenance-status`

When a room already marked critical receives a second critical-room event, applyHardwareEvent keeps the first event's status and takes the higher reading. If a live packet marks a room (OBSERVED) and the operator then starts a replay ("Rejouer démo" or "Charger un rejeu…") without re-engaging, a higher REPLAY reading for that room replaces the value. The hardware danger list then shows the replayed number with the OBSERVED badge. This contradicts CLAUDE.md section 4 (a value is worth its weakest input) and R3 (every displayed number carries its true label). The opposite order (replay first, live second) keeps the REPLAY label on a live value, which errs toward the weaker label. Impact is bounded: the verdict is unchanged (NO-GO either way), the room was genuinely marked by a live reading, and the replay banner stays visible at the top of the same panel. Only the provenance label on the displayed maximum is wrong, and the operator is the same principal (the COS) who started the replay. The code path is deterministic and was read in full, but nothing was executed.

**Claimed root cause.** The known-room branch of applyHardwareEvent (state.ts line 44) merges events of possibly different origin by taking the max of valueC and the min of thresholdC but copies only the first event's status. It does not take worstStatus of the two, so the shown maximum can come from a REPLAY event while labelled OBSERVED.

**Source trace.**
1. `entrypoint` app/src/hardware/serialManager.ts:126 (SerialManager.readLoop): A live temp_bmp280 packet from the drone port is parsed (line 123) and delivered to onMessage, which useHardware routes to handle(role, msg, 'live').
2. `propagation` app/src/hardware/useHardware.ts:80 (useHardware.handle): decide(msg, 'live', ...) returns a critical-room event with status OBSERVED when the reading is at or above the threshold (ingest.ts lines 42-45). dispatch passes it through the EventGate and sends the 'hardware' action to the worker.
3. `propagation` app/src/hardware/state.ts:45 (applyHardwareEvent): For a room not yet marked, the entry is created with status ev.status (OBSERVED). sim.ts line 420 calls this from applyHardware, reached from actions.ts line 16.
4. `propagation` app/src/hardware/useHardware.ts:147 (startReplay): A replay starts. gate.current.reset() empties the EventGate memory so replay events pass, and the worker's s.hardware.critical is left untouched (only the COS re-engage clears it, sim.ts line 630).
5. `propagation` app/src/hardware/replay.ts:197 (Replayer.fire): Replay entries are parsed (line 196) and delivered to onMessage, which useHardware routes to handle(role, msg, 'replay'). decide(..., 'replay') (useHardware.ts line 80) then produces critical-room events with status REPLAY. The built-in sample ramps the solvent store from 24 to 48 °C (config.json samplePeakC).
6. `propagation` app/src/hardware/state.ts:44 (applyHardwareEvent): For a known room the entry becomes {...c, valueC: Math.max(c.valueC, ev.valueC), thresholdC: Math.min(...)}. The spread keeps c.status (OBSERVED) while valueC may now come from the REPLAY event.
7. `propagation` app/src/sim/protocol.ts:162 (snapshot): The snapshot carries s.hardware.critical, with its status field, to the PC panel.
8. `sink` app/src/panels/HardwarePanel.tsx:157 (hw-dangers list): c.valueC is rendered with <Num ... status={c.status} />, so the replayed maximum is shown with the OBSERVED badge.

**Verified evidence.**
- app/src/hardware/state.ts:44: The merge of an existing critical room updates valueC and thresholdC but never status. There is no worstStatus call in this file.
- app/src/hardware/ingest.ts:19: statusOf maps origin 'replay' to REPLAY and 'live' to OBSERVED, so both labels can reach the same room entry.
- app/src/hardware/useHardware.ts:128: The only reset of the gate's critical memory besides startReplay is when the snapshot shows no critical rooms, so a live-marked room persists into a replay.
- CLAUDE.md:81: Section 4 (lines 81-82): worstStatus orders OBSERVED < ... < REPLAY, and a value is worth its weakest input. R3 (line 19) requires every displayed number to carry its label.
- app/src/hardware/hardwareSim.test.ts:67: The existing test for repeated readings of one room only uses OBSERVED events, so the mixed-origin merge is untested.

**Blockers.**
- No OS-enforced sandbox exists on the audit host, so the pure-function result (status kept as OBSERVED after a REPLAY event raises valueC) was derived by reading and not observed.
- Whether an operator would start a replay while a live-marked room is still latched, and whether the replay banner shown above the danger list is enough, is a usage and impact judgement. The impact is label-only: the verdict stays NO-GO and the room stays correctly marked.

**Bounded local check.** In a new vitest file under app/src/hardware, run in a sandbox. Step 1: h1 = applyHardwareEvent(initialHardware(), {kind:'critical-room', room:2, roomName:'x', valueC:40, thresholdC:35, status:'OBSERVED'}, 10). Step 2: h2 = applyHardwareEvent(h1, {kind:'critical-room', room:2, roomName:'x', valueC:48, thresholdC:35, status:'REPLAY'}, 20). Assert h2.critical has length 1 and h2.critical[0].valueC is 48. Then read h2.critical[0].status: the current code is expected to give 'OBSERVED', while the intended value is worstStatus('OBSERVED','REPLAY'), which is 'REPLAY'. A second check can reuse the hot(room, value, status) and send helpers in app/src/hardware/hardwareSim.test.ts: send hot(solvents,40) then hot(solvents,48,'REPLAY') and read snapshot(ctx,s).hardware.critical[0]. Also assert that the verdict stays NO-GO and the reason status is unchanged.

**Owner-observed deployment check.** Owner-run on a local browser (Chrome or Edge, no network): with a fake serial port or the drone payload sending a solvent-store reading of about 40 °C (above the 35 °C threshold), wait for the danger line, then click 'Rejouer démo' without re-engaging. After the sample reaches the solvent store, check whether the 'Dangers relevés par le matériel' line shows 48.0 °C with the OBSERVED badge while the replay banner is displayed.

## 4. Cylinder pressure is ignored after a simulation reset because the EventGate keeps its last ari value

Fingerprint: `hw-eventgate-ari-memory-survives-sim-reset`

EventGate remembers the last rounded cylinder pressure it let through and drops any later ari reading that rounds to the same bar. Only startReplay clears it, through gate.reset(). The effect on [critical, mayday] clears only the critical-room and mayday records. The PC 'Réinitialiser' button posts a worker 'reset' that rebuilds the whole SimState, so s.hardware.ari goes back to null, but the gate still holds the old pressure. A steady reading from the HUD, for example a potentiometer left at 40 bar (below the whistle), keeps being suppressed. The worker then never receives an ari event, and the PNR and verdict use the model's air as if the cylinder were full. This weakens the R13 intent that the live cylinder pressure feeds the PNR when it is lower than the model's. The PC panel keeps showing the old pressure as OBSERVED, because useHardware's telemetry state is not reset either. So the operator sees a low value while the verdict ignores it. The effect is bounded: it needs a COS-initiated reset, which the auto demo's reset path (useDemo.ts:93) also triggers. It lasts until the rounded pressure moves by about 1 bar, and it can only make the PNR more optimistic than the cylinder warrants. The deterministic part (gate suppression after reset) is source-visible. How often it shows up with a real HUD is not.

**Claimed root cause.** The gate's per-kind delivery memory for ari is not tied to the lifecycle of the worker state it mirrors. useHardware clears gate.critical and gate.mayday from snapshot values, but nothing clears gate.ari when the simulation resets and s.hardware.ari returns to null. The gate therefore treats an unchanged rounded pressure as already delivered.

**Source trace.**
1. `entrypoint` app/src/hardware/serialManager.ts:122 (SerialManager.readLoop): A HUD line such as {"sensor":"ari_bar","value":40.1,...} is split out of the serial stream, parsed by parseLine (line 123) and passed to onMessage (line 126). The HUD firmware emits ari_bar every 400 ms.
2. `propagation` app/src/hardware/ingest.ts:48 (decide): ari_bar becomes an {kind:'ari', bar} event, clamped to [0, startBar]. It is returned for every packet with no change test, so de-duplication is left to the gate.
3. `propagation` app/src/hardware/gate.ts:27 (EventGate.pass): If Math.round(ev.bar) (line 26) equals this.ari, pass() returns false. Otherwise this.ari is recorded (line 28). clearCritical and clearMayday do not touch ari.
4. `propagation` app/src/panels/Pc.tsx:77 (PC 'Réinitialiser' button): onClick calls sim.reset(), which queues {type:'reset', seed} (client.ts:97-101). worker.ts:21 turns it into initSim(...). useHardware is not notified.
5. `propagation` app/src/sim/sim.ts:185 (initSim): The new state starts with hardware: initialHardware(), so ari is null. The EventGate held in a ref in useHardware is not touched.
6. `propagation` app/src/hardware/useHardware.ts:130 (effect on [critical, mayday]): This effect (derived values at lines 128-129, effect body 130-133) clears only the critical and mayday gate records. gate.current.reset(), which clears ari, is called only from startReplay at line 147.
7. `sink` app/src/sim/sim.ts:408 (airTrack / teamNow): With s.hardware.ari null, airTrack returns the plan unshifted (line 408). teamNow computes extraL = 0 through ariExtraUsedL (line 641), so ariBinding is false. The PNR and verdict use the model's air while the PC panel still shows the lower cylinder pressure from telemetry.

**Verified evidence.**
- app/src/hardware/gate.ts:27: 'if (rounded === this.ari) return false' drops an unchanged rounded pressure. reset() at line 43 (ari = NaN at line 46) is the only place ari is cleared.
- app/src/hardware/useHardware.ts:147: gate.current.reset() occurs only in startReplay. The effect at lines 130-133 clears critical and mayday only. No effect watches snap.hardware.ari or the clock going back.
- app/src/sim/client.ts:97: The reset action posts a worker reset without notifying the hardware layer.
- app/src/hardware/state.ts:53: clearHardware (re-engage) deliberately keeps ari, so the gate and the sim stay in step there. initialHardware (line 33), used by initSim on reset, sets ari to null, which is the divergence.
- firmware/binome_hud/binome_hud.ino:194: The HUD prints ari_bar every 400 ms from an averaged 10-bit ADC read (readBar, line 76). A potentiometer held still gives a mostly stable rounded value, but ADC jitter across a rounding boundary would re-deliver, so how often this suppression happens in use is not source-visible.
- app/src/panels/HardwarePanel.tsx:98: 'Pression ARI relevée' renders telemetry.hud.ariBar labelled OBSERVED. That telemetry is not reset by the sim reset.
- app/src/hardware/gate.test.ts:27: The existing test covers rounding de-duplication but no reset sequence. Line 51 covers gate.reset() only.

**Blockers.**
- No target code may be executed on this audit host (no OS-enforced sandbox: Windows 11, no WSL or container runtime), so the gate-suppression-after-reset result could not be observed locally.
- Whether a steady rounded pressure persists across a reset in real use depends on the HUD input (potentiometer ADC jitter versus a draining cylinder), which is not source-visible.

**Bounded local check.** In a vitest file in the style of app/src/hardware/gate.test.ts, build a SimContext as app/src/sim/worker.ts does (buildSite, fireSetupOf, defaultFireParams, loadPredictor, makeContext). Create an EventGate and a state with initSim(ctx, initialDoors(site), 42). Run decide() on an ari_bar 40.0 packet (live origin), pass the event through gate.pass, and apply it with applyHardware(ctx, s, ev). Assert s.hardware.ari is set and teamNow(ctx, s).ariBinding is true. Then rebuild the state with initSim again (what the worker does for 'reset') and run decide() on an ari_bar 40.1 packet through the same gate. Expected correct behaviour: gate.pass returns true. Behaviour to confirm: it returns false while s.hardware.ari is null and teamNow(ctx, s).ariBinding is false, so the PNR equals the no-hardware baseline. Also confirm that a packet of 41.0 afterwards passes. Pure in-memory test; no network, no serial port.

**Owner-observed deployment check.** Owner-observed, on the owner's own HUD (or a fake serial port) and non-production: with a steady pressure below the whistle, press 'Réinitialiser' in the PC window. Check whether 'Pression ARI relevée' keeps showing the low value while the team air figure and PNR follow the model. Then move the potentiometer by about 1 bar and check that they correct themselves.

