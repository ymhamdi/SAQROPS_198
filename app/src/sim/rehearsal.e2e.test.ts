// The video scenario WITH the rehearsal (CLAUDE.md §9): the indoor drone flies first, PNR rehearses the mission on what it
// knows, the COS validates the plan, and then the intervention goes as before. The scenario without rehearsal is in
// demo.test.ts and must keep passing on its own.

import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { rehearse } from '../rehearsal/engine'
import { knownInputOf } from '../rehearsal/input'
import { buildSite } from '../site/site'
import { applyAction } from './actions'
import { snapshot } from './protocol'
import { initSim, makeContext, teamNow, tick } from './sim'

describe('video scenario with the rehearsal', { timeout: 60_000 }, () => {
  test('indoor drone → rehearsal → plan validated by the COS → the same intervention', () => {
    const site = buildSite()
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const s = initSim(ctx, initialDoors(site), 42)
    const door = site.doors.findIndex((d) => d.id === 'd-solvants-peinture')
    const booth = site.rooms.findIndex((r) => r.id === 'peinture')
    const log: string[] = []
    const run = (until: (x: typeof s) => boolean, max = 600) => {
      for (let k = 0; k < max && !until(s); k++) tick(ctx, s)
    }

    // 1. Fire in the solvent store; the outdoor drone, then the indoor one goes in first.
    applyAction(ctx, s, { type: 'fire', at: site.demo.fireAt })
    run((x) => x.fire.t >= 25)
    applyAction(ctx, s, { type: 'indoor' })
    expect(s.indoor.status).toBe('flown')
    run((x) => x.fire.t >= 60)
    applyAction(ctx, s, { type: 'drone' })
    log.push(`t=${s.fire.t} drones: indoor flight ${Math.round(s.indoor.plan!.durationS)} s, ${s.indoor.observations.length} observations`)
    // The drone found the collapsed rack the plan does not show; the door it could not open stays UNKNOWN behind.
    const rack = site.hidden[0].cells
    const found = s.indoor.observations.find((o) => o.kind === 'obstacle')
    expect(found?.cells).toEqual(rack)
    expect(s.known.blockedCells).toEqual(expect.arrayContaining(rack))
    expect(s.known.rooms[site.rooms.findIndex((r) => r.id === 'tgbt')].unknown).toBe(true)
    // Finding it while the team waits must not read as a NO-GO that the latch would keep (R6): the route is re-planned first.
    expect(s.latch.latched).toBe(false)

    // 2. The rehearsal, on what PNR knows, in well under a second.
    run((x) => x.fire.t >= 90)
    const t0 = performance.now()
    const plan = rehearse(site, knownInputOf(site, snapshot(ctx, s)))
    const ms = performance.now() - t0
    log.push(`t=${s.fire.t} rehearsal in ${ms.toFixed(0)} ms: ${plan.verdict}, order ${plan.order.join(' → ')}, exit ${Math.round(plan.exitBar)} bar, turn back ${Math.round(plan.turnBackS ?? 0)} s`)
    expect(ms).toBeLessThan(1000)
    expect(plan.verdict).toBe('GO')
    expect(new Set(plan.order)).toEqual(new Set(site.demo.objectives))
    // The plan goes round the rack, and says what the detour costs.
    for (const p of plan.track) expect(rack).not.toContain(p.cell)
    expect(plan.reasons.some((r) => r.message.includes('Passage obstrué') && r.source === 'drone')).toBe(true)
    // The rehearsal alone changed nothing: the team is still waiting.
    expect(s.team.mode).toBe('standby')
    expect(s.plan).toBeNull()

    // 3. The COS validates the plan (its decision, at 100 s as in the script): now the team goes.
    run((x) => x.fire.t >= v(H.demo.engageAtS))
    applyAction(ctx, s, { type: 'plan-validate', plan })
    expect(s.team.mode).toBe('engaged')
    expect(s.team.objectives).toEqual(plan.order)
    // The team's own route goes round it too, now that PNR knows.
    for (const p of s.team.track) expect(rack).not.toContain(p.cell)
    expect(s.shown.verdict).toBe('GO')
    expect(s.plan?.plan.verdict).toBe('GO')
    log.push(`t=${s.fire.t} plan validated, engaged: ${s.shown.verdict}`)

    // 4. As in the script: the model flags the booth, NO-GO, the way out above the whistle.
    run((x) => x.latch.latched)
    expect(s.shown.reasons.some((r) => r.code === 'FLASHOVER_PREDICTED' && r.severity === 'no-go')).toBe(true)
    expect(s.team.mode).toBe('evacuating')
    expect(teamNow(ctx, s).exitBar!).toBeGreaterThan(ctx.air.whistleBar)
    log.push(`t=${s.fire.t} NO-GO: ${s.shown.reasons[0].message}`)

    // 5. The store ↔ booth door is closed: the verdict stays NO-GO (R6).
    applyAction(ctx, s, { type: 'door', door })
    run(() => false, 15)
    expect(s.shown.verdict).toBe('NO-GO')
    run((x) => x.team.mode === 'out')
    expect(teamNow(ctx, s).bar).toBeGreaterThan(ctx.air.whistleBar)
    log.push(`t=${s.fire.t} team out at ${teamNow(ctx, s).bar.toFixed(0)} bar; booth flashover ${s.fire.rooms[booth].flashedAt}`)

    // 6. The PC takes the booth objective off and re-engages (decision COS).
    applyAction(ctx, s, { type: 'objectives', ids: site.demo.thenObjectives, note: 'Objectif cabine retiré par le PC' })
    applyAction(ctx, s, { type: 'reengage' })
    expect(s.team.mode).toBe('engaged')
    expect(s.latch.log.at(-1)).toMatchObject({ action: 'RE-ENGAGE', by: 'COS' })
    console.log(log.join('\n'))
  })
})
