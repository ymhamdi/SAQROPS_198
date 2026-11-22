// The crew screens' new scenes: the mission phase strip, the view that steps outside once the team is out, the waypoint
// marks, and the HUD and tablet windows themselves (R2: « Décision : COS » on the tablet, never on the HUD; R3: labels).

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { Hud } from '../panels/Hud'
import { Tablet } from '../panels/Tablet'
import { loadPredictor } from '../ml/predict'
import { snapshot, type Snapshot } from '../sim/protocol'
import { engage, initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite, cellAt } from '../site/site'
import { CELL } from '../types'
import { poseTarget } from './camera'
import { missionOf, MISSION_STEPS } from './mission'
import { marksOf, placeOf } from './Scene'

const site = buildSite()

/** The video scenario, one snapshot per simulated second up to 300 s: fire at the solvents, team engaged at 100 s. */
function run(): Snapshot[] {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  const out: Snapshot[] = [snapshot(ctx, s)]
  startFire(ctx, s, site.demo.fireAt)
  for (let k = 0; k < 300; k++) {
    if (k === 100) engage(ctx, s)
    tick(ctx, s)
    out.push(snapshot(ctx, s))
  }
  return out
}

describe('the crew scenes follow the video scenario', { timeout: 120_000 }, () => {
  const snaps = run()

  test('the mission goes from waiting to advancing, to the way out under a NO-GO, to out', () => {
    const phases: number[] = []
    for (const s of snaps) {
      const m = missionOf(s)
      if (phases.at(-1) !== m.current) phases.push(m.current)
    }
    expect(phases).toEqual([0, 1, 2, 3])
    const exit = snaps.find((s) => missionOf(s).current === 2)!
    expect(missionOf(exit).noGo).toBe(true)
    expect(MISSION_STEPS[2].id).toBe('exit')
    expect(missionOf(snaps[0]).objectives).toEqual({ done: 0, total: 2 })
  })

  test('once out, the view stands outside the building and looks back at the exit door', () => {
    const out = snaps.at(-1)!
    expect(out.team.mode).toBe('out')
    const pose = poseTarget(site, out, null)!
    expect(site.kind[cellAt(site, pose)]).toBe(CELL.OUTSIDE)
    const door = site.doors[site.door[out.team.track.at(-1)!]]
    const towardDoor = (door.centre.x - pose.x) * Math.cos(pose.heading) + (door.centre.y - pose.y) * Math.sin(pose.heading)
    expect(towardDoor).toBeGreaterThan(1)
  })

  test('the view points out the next goal while engaged, the exit while leaving, and the rooms the AI flags', () => {
    const engaged = snaps.find((s) => s.team.mode === 'engaged' && !s.rooms.some((r) => r.pred?.alert))!
    const goal = marksOf(site, engaged).find((m) => m.shape === 'diamond')!
    expect(goal.text).toBe(placeOf(site.objectives.find((o) => o.id === engaged.team.objectives[0])!.name))
    const leaving = snaps.find((s) => s.team.mode === 'evacuating')!
    expect(marksOf(site, leaving).some((m) => m.shape === 'sign' && m.text === 'SORTIE')).toBe(true)
    const flagged = snaps.find((s) => s.rooms.some((r) => r.pred?.alert))!
    expect(marksOf(site, flagged).some((m) => m.shape === 'warning')).toBe(true)
  })

  test('the place part of an objective’s name is what is shown in the scene', () => {
    expect(placeOf('Victime signalée — cabine de peinture')).toBe('cabine de peinture')
    expect(placeOf('Sans tiret')).toBe('Sans tiret')
  })

  test('the HUD names its view as synthetic, and never carries « Décision : COS » (R2)', () => {
    const s = snaps.find((x) => x.shown.verdict === 'NO-GO')!
    const html = renderToStaticMarkup(createElement(Hud, { site, snap: s }))
    expect(html).toContain('Vue synthétique')
    expect(html).toContain('badge-simulated')
    expect(html).not.toContain('Décision : COS')
    expect(html).toContain('AIR')
    expect(html).toContain('PNR')
  })

  test('the tablet shows the mission and the map controls, always with « Décision : COS » (R2), every number labelled (R3)', () => {
    for (const s of [snaps[0], snaps.find((x) => x.shown.verdict === 'NO-GO')!, snaps.at(-1)!]) {
      const html = renderToStaticMarkup(createElement(Tablet, { site, snap: s }))
      expect(html).toContain('Décision : COS')
      for (const text of ['Mission', 'En attente', 'Progression', 'Sortie', 'Sorti', 'Cap en haut', 'Nord en haut', 'Plan complet', 'Zoom avant']) expect(html).toContain(text)
      const nums = html.match(/<span class="num">.*?<\/span><\/span>/g) ?? []
      expect(nums.length).toBeGreaterThanOrEqual(5)
      for (const n of nums) expect(n).toContain('class="badge badge-')
      expect(html).not.toContain('badge-observed')
    }
  })
})
