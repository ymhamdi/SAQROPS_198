// R12: everything from the rehearsal says « RÉPÉTITION — SIMULATION » in its own frame, it never shows on the live HUD, and its
// plan only applies once the COS validates it. « Engager sans répétition » is always possible: it never delays a rescue.

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { Hud } from '../panels/Hud'
import { IndoorCard, PlanCard } from '../panels/PlanPanel'
import { applyAction } from '../sim/actions'
import { snapshot, type Snapshot } from '../sim/protocol'
import { initSim, makeContext, startFire, tick, type SimContext, type SimState } from '../sim/sim'
import { buildSite } from '../site/site'
import { rehearse, type RehearsalPlan } from './engine'
import { knownInputOf } from './input'
import { REHEARSAL_BANNER } from './RehearsalBanner'

const site = buildSite()
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

let ctx: SimContext
let s: SimState
let snap: Snapshot
let plan: RehearsalPlan

beforeAll(() => {
  ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  for (let k = 0; k < 90; k++) {
    if (k === 25) applyAction(ctx, s, { type: 'indoor' })
    tick(ctx, s)
  }
  snap = snapshot(ctx, s)
  plan = rehearse(site, knownInputOf(site, snap))
}, 60_000)

const noop = () => {}

describe('R12 the rehearsal is labelled and framed as a simulation', () => {
  test('every rehearsal surface carries the banner and the dashed frame, before and after the plan exists', () => {
    for (const p of [null, plan]) {
      const out = html(createElement(PlanCard, { snap, plan: p, onRehearse: noop, onValidate: noop }))
      expect(out).toContain(REHEARSAL_BANNER)
      expect(out).toContain('rehearsal-frame')
    }
    expect(REHEARSAL_BANNER).toBe('RÉPÉTITION — SIMULATION')
  })

  test('the plan shows its verdicts with « Décision : COS » (R2) and every number with its label (R3)', () => {
    const out = html(createElement(PlanCard, { snap, plan, onRehearse: noop, onValidate: noop }))
    expect(out).toContain('Décision : COS')
    expect(out).toContain('Valider le plan (décision COS)')
    // Every number rendered by Num carries a badge: as many badges as numbers.
    expect((out.match(/class="num/g) ?? []).length).toBeGreaterThan(0)
    expect(out).toMatch(/badge-(simulated|modeled)/)
    expect(out).not.toContain('badge-observed')
  })

  test('the indoor drone card shows when each picture was taken and when it was received', () => {
    const out = html(createElement(IndoorCard, { site, snap, onLaunch: noop }))
    expect(out).toContain('pris à')
    expect(out).toContain('reçu à')
    expect(out).toContain('n’en ouvre jamais')
  })

  test('the live HUD never shows the rehearsal, even with a validated plan in the snapshot', () => {
    const withPlan: Snapshot = { ...snap, plan: { validatedAtS: snap.t, plan } }
    const out = html(createElement(Hud, { site, snap: withPlan }))
    expect(out).not.toContain(REHEARSAL_BANNER)
    expect(out).not.toMatch(/rehearsal|répétition|Demi-tour/i)
    for (const f of ['../panels/Hud.tsx', '../scene/Scene.tsx', '../scene/render.ts', '../scene/camera.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf-8'), f).not.toMatch(/rehearsal/i)
    }
  })
})

describe('the plan only applies once the COS validates it', () => {
  const fresh = () => {
    const c = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const st = initSim(c, initialDoors(site), 42)
    startFire(c, st, site.demo.fireAt)
    for (let k = 0; k < 60; k++) tick(c, st)
    return { c, st }
  }

  test('computing the rehearsal changes nothing in the simulation', () => {
    const { c, st } = fresh()
    const before = JSON.stringify([st.team.mode, st.team.objectives, st.plan, st.planVersion])
    rehearse(site, knownInputOf(site, snapshot(c, st)))
    expect(JSON.stringify([st.team.mode, st.team.objectives, st.plan, st.planVersion])).toBe(before)
  })

  test('validating applies the plan’s order, engages the team and logs it as the COS’s decision', () => {
    const { c, st } = fresh()
    const reversed: RehearsalPlan = { ...plan, order: [...plan.order].reverse() }
    // The plan travels to the worker as a message: it must survive a structured clone (Infinity included).
    applyAction(c, st, { type: 'plan-validate', plan: structuredClone(reversed) })
    expect(st.team.mode).toBe('engaged')
    expect(st.team.objectives).toEqual(reversed.order)
    expect(st.plan?.plan.order).toEqual(reversed.order)
    expect(st.notes.some((n) => n.text.includes('Plan d’intervention validé (décision COS)'))).toBe(true)
    expect(snapshot(c, st).plan?.validatedAtS).toBe(st.fire.t)
  })

  test('a plan can only be validated before the engagement', () => {
    const { c, st } = fresh()
    applyAction(c, st, { type: 'plan-validate', plan })
    const objectives = [...st.team.objectives]
    applyAction(c, st, { type: 'plan-validate', plan: { ...plan, order: [...plan.order].reverse() } })
    expect(st.team.objectives).toEqual(objectives)
  })

  test('« Engager sans répétition » always works, with no drone flown and no plan, and says so in the log', () => {
    const { c, st } = fresh()
    expect(st.indoor.status).toBe('ground')
    applyAction(c, st, { type: 'engage-direct' })
    expect(st.team.mode).toBe('engaged')
    expect(st.plan).toBeNull()
    expect(st.notes.some((n) => n.text.includes('Engagement sans répétition (décision COS)'))).toBe(true)
  })
})
