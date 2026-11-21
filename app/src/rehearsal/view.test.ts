// The rehearsal view: the HUD's first-person scene fed by the rehearsal's projected state. It must carry no simulator truth
// (R11), show what the projection says (a room that will be impassable looks different), and stay out of the live tab (R12).

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { poseTarget } from '../scene/camera'
import { renderScene } from '../scene/render'
import { applyAction } from '../sim/actions'
import { snapshot, type Snapshot } from '../sim/protocol'
import { initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { Twin } from '../twin/Twin'
import { rehearse, type KnownInput, type RehearsalPlan } from './engine'
import { knownInputOf } from './input'
import { REHEARSAL_BANNER } from './RehearsalBanner'
import { RehearsalView } from './RehearsalView'
import { sceneAt } from './sceneState'

const site = buildSite()
const booth = site.rooms.findIndex((r) => r.id === 'peinture')
let snap: Snapshot
let input: KnownInput
let plan: RehearsalPlan

beforeAll(() => {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  for (let k = 0; k < 216; k++) {
    if (k === 25) applyAction(ctx, s, { type: 'indoor' })
    tick(ctx, s)
  }
  snap = structuredClone(snapshot(ctx, s))
  input = knownInputOf(site, snap)
  plan = rehearse(site, input)
}, 60_000)

const surface = (w = 64, h = 36) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })

describe('the rehearsal scene', () => {
  test('it carries only what the view reads: no simulator truth can reach it (R11)', () => {
    const scene = sceneAt(input, plan, 30)
    expect(Object.keys(scene).sort()).toEqual(['doorOpen', 'rooms', 'team'])
    for (const r of scene.rooms) expect(Object.keys(r).sort()).toEqual(['condition', 'pred'])
    expect(JSON.stringify(scene)).not.toMatch(/truth|layerC|flashedAt|roofC/)
  })

  test('the team follows the planned route, and the objectives left to reach shrink as it goes', () => {
    const start = sceneAt(input, plan, 0)
    const end = sceneAt(input, plan, plan.track.at(-1)!.arriveS + 1)
    expect(start.team.cell).toBe(plan.track[0].cell)
    expect(start.team.objectives).toEqual(plan.order)
    expect(end.team.cell).toBe(plan.track.at(-1)!.cell)
    expect(end.team.objectives).toEqual([])
  })

  test('a room the rehearsal projects as impassable looks different in the view', () => {
    const close = plan.closeAtS[booth]
    expect(close).toBeLessThan(Infinity)
    const before = sceneAt(input, plan, close - 1)
    const after = sceneAt(input, plan, close + 1)
    expect(before.rooms[booth].condition).not.toBe('failed')
    expect(after.rooms[booth].condition).toBe('failed')
    // Same viewpoint, where the team works in the booth: only the projection differs.
    const atVictim = plan.timeline.find((e) => e.kind === 'objective' && e.label.includes('cabine'))!.tS
    const pose = poseTarget(site, sceneAt(input, plan, atVictim), null)!
    const a = surface()
    const b = surface()
    renderScene(a, site, before, pose)
    renderScene(b, site, after, pose)
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(false)
  })

  test('the view is the same one the live HUD draws: the live snapshot renders with the same function', () => {
    const pose = poseTarget(site, snap, null)!
    expect(() => renderScene(surface(), site, snap, pose)).not.toThrow()
  })
})

describe('R12 on the rehearsal surfaces', () => {
  test('the replay says « RÉPÉTITION — SIMULATION » on its frame and on the image, with « Décision : COS »', () => {
    const out = renderToStaticMarkup(createElement(RehearsalView, { site, input, plan }))
    expect((out.match(new RegExp(REHEARSAL_BANNER, 'g')) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(out).toContain('rehearsal-frame')
    expect(out).toContain('Décision : COS')
    expect(out).toContain('PNR')
    expect(out).toContain('AIR')
  })

  test('the twin has a « Répétition » tab apart; the live tab never shows the rehearsal', () => {
    // Node has no ImageData, which the plan drawing creates while rendering.
    vi.stubGlobal(
      'ImageData',
      class {
        data: Uint8ClampedArray
        width: number
        height: number
        constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
          if (typeof a === 'number') {
            this.width = a
            this.height = b
            this.data = new Uint8ClampedArray(a * b * 4)
          } else {
            this.data = a
            this.width = b
            this.height = c!
          }
        }
      },
    )
    const out = renderToStaticMarkup(createElement(Twin, { site, snap }))
    vi.unstubAllGlobals()
    expect(out).toContain('Direct')
    expect(out).toContain('Répétition')
    expect(out).not.toContain(REHEARSAL_BANNER)
    expect(out).not.toContain('rehearsal-frame')
  })
})
