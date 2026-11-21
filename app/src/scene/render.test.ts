// The synthetic view: rays through the real plan, smoke from the detectors only, and R5 (nothing of the simulator's truth).

import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import type { RoomCondition } from '../danger/rules'
import type { Predictor } from '../ml/predict'
import { snapshot, type Snapshot } from '../sim/protocol'
import { engage, initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite, cellAt } from '../site/site'
import { CELL } from '../types'
import { angleDiff, approach, bearingOf, poseTarget, routePose, type Pose } from './camera'
import { castColumn, project, rayOf, renderScene, EYE_M, type Surface } from './render'

const site = buildSite()
const idle: Predictor = { predict: () => ({ p30: 0, p60: 0, tffS: 300 }), thresholds: { p30: 0.5, p60: 0.5 }, dummy: false, trainedOn: 'stub' }
const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), idle)
const fresh = (): Snapshot => snapshot(ctx, initSim(ctx, initialDoors(site), 1))
const surface = (w = 160, h = 90): Surface => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
const allRooms = (s: Snapshot, condition: RoomCondition): Snapshot => ({ ...s, rooms: s.rooms.map((r) => ({ ...r, condition })) })
const centre = (img: Surface, x: number, y: number) => {
  const o = (y * img.width + x) * 4
  return [img.data[o], img.data[o + 1], img.data[o + 2]]
}
const door = (id: string) => site.doors.findIndex((d) => d.id === id)

describe('the camera', () => {
  test('angles turn the short way round', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2)
    expect(angleDiff(-3.1, 3.1)).toBeCloseTo(2 * Math.PI - 6.2)
    expect(bearingOf(0)).toBeCloseTo(90)
    expect(bearingOf(-Math.PI / 2)).toBeCloseTo(0)
  })

  test('it glides towards a pose, and cuts when the jump is a re-plan', () => {
    const a: Pose = { x: 0, y: 0, heading: 0 }
    const b: Pose = { x: 4, y: 0, heading: 1 }
    const step = approach(a, b, 0.1, 0.25)
    expect(step.x).toBeGreaterThan(0)
    expect(step.x).toBeLessThan(4)
    expect(approach(a, { x: 40, y: 0, heading: 2 }, 0.1, 0.25)).toEqual({ x: 40, y: 0, heading: 2 })
  })

  test('it starts at the entry looking along the planned route, into the building', () => {
    const p = poseTarget(site, fresh(), null)!
    const entry = site.doors[site.demo.entry].centre
    expect(Math.hypot(p.x - entry.x, p.y - entry.y)).toBeLessThan(2.5)
    expect(Math.cos(p.heading)).toBeGreaterThan(0) // the west exit: the route heads east
  })

  test('a team standing in a doorway is seen from just inside the room, not from the doorframe', () => {
    const s = fresh()
    const here = routePose(site, s, null)!
    expect(site.kind[cellAt(site, here)]).toBe(CELL.EXIT) // the team stands in the exit
    const eye = poseTarget(site, s, null)!
    expect(site.kind[cellAt(site, eye)]).toBe(CELL.FLOOR)
    expect(eye.heading).toBe(here.heading)
  })
})

describe('rays through the real plan', () => {
  const east: Pose = { x: 35, y: 24, heading: 0 }
  const ray = rayOf(east, 0)
  const open = initialDoors(site).map(() => false)
  const clear = site.rooms.map((): RoomCondition => 'clear')

  test('a ray across the hall ends on the east exit, about where the plan puts it', () => {
    const col = castColumn(site, open, clear, east, ray)
    const last = col.hits.at(-1)!
    expect(last.kind).toBe('exit')
    expect(last.perpM).toBeGreaterThan(29)
    expect(last.perpM).toBeLessThan(30.5)
    expect(col.blockM).toBe(last.perpM)
  })

  test('a closed door blocks the ray; an open one lets it through to the wall behind', () => {
    const north: Pose = { x: 17.5, y: 20, heading: -Math.PI / 2 }
    const r = rayOf(north, 0)
    const tgbt = door('d-tgbt')
    const shut = castColumn(site, open, clear, north, r)
    expect(shut.hits.at(-1)!.kind).toBe('door')
    expect(shut.blockM).toBeGreaterThan(8)
    expect(shut.blockM).toBeLessThan(10)
    const ajar = open.map((_, i) => i === tgbt)
    const through = castColumn(site, ajar, clear, north, r)
    expect(through.hits.some((h) => h.kind === 'lintel')).toBe(true)
    expect(through.hits.at(-1)!.kind).toBe('wall')
    expect(through.blockM).toBeGreaterThan(shut.blockM + 4)
  })

  test('a partition is only as tall as the lower of the two rooms it separates', () => {
    // From the hall (8 m) looking at the paint booth's wall (booth 4 m).
    const south: Pose = { x: 12, y: 30, heading: Math.PI / 2 }
    const col = castColumn(site, open, clear, south, rayOf(south, 0))
    const wall = col.hits.find((h) => h.kind === 'wall' || h.kind === 'door')!
    expect(wall.topM).toBeLessThanOrEqual(4)
  })

  test('smoke builds up along a ray through a smoky room', () => {
    const smoky = site.rooms.map((): RoomCondition => 'failed')
    const a = castColumn(site, open, clear, east, ray)
    const b = castColumn(site, open, smoky, east, ray)
    expect(b.hits.at(-1)!.tau).toBeGreaterThan(a.hits.at(-1)!.tau * 5)
    expect(b.hits.at(-1)!.rank).toBe(3)
  })

  test('the projection puts what is ahead on the screen, and nothing that is behind', () => {
    const p: Pose = { x: 10, y: 10, heading: 0 }
    const ahead = project(p, 800, 400, 20, 10, EYE_M)!
    expect(ahead.x).toBeCloseTo(400)
    expect(ahead.y).toBeCloseTo(200)
    const floor = project(p, 800, 400, 20, 10, 0)!
    expect(floor.y).toBeGreaterThan(200)
    expect(project(p, 800, 400, 5, 10, 0)).toBeNull()
    const right = project(p, 800, 400, 20, 12, EYE_M)!
    expect(right.x).toBeGreaterThan(400) // south is on the right when facing east
  })
})

describe('what the scene looks like', () => {
  const pose: Pose = { x: 35, y: 24, heading: 0 }

  test('it draws every pixel, and takes a fraction of a second', () => {
    const img = surface(320, 180)
    const t0 = performance.now()
    renderScene(img, site, fresh(), pose)
    expect(performance.now() - t0).toBeLessThan(1500)
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255)
  })

  test('smoke and lost detectors turn the far end of a view to haze, with the colour of what the detectors report', () => {
    const base = fresh()
    const a = surface()
    const b = surface()
    renderScene(a, site, allRooms(base, 'clear'), pose)
    renderScene(b, site, allRooms(base, 'failed'), pose)
    const [r0, , b0] = centre(a, 80, 40)
    const [r1, , b1] = centre(b, 80, 40)
    expect(b0).toBeGreaterThan(r0) // clear: a cool grey-blue ceiling and wall
    expect(r1).toBeGreaterThan(b1) // detectors lost: a red haze
  })

  test('R5: the scene never reads the simulator’s truth', () => {
    const real = fresh()
    const altered: Snapshot = {
      ...real,
      rooms: real.rooms.map((r) => ({ ...r, truth: { layerC: 900, layerZ: 0, qKw: 99_999, ignitedAt: 1, flashedAt: 2, fireAt: { x: 30, y: 24 } } })),
    }
    const a = surface()
    const b = surface()
    renderScene(a, site, real, pose)
    renderScene(b, site, altered, pose)
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
  })

  test('it follows a real run: the team’s view stays valid while the fire grows and the verdict turns', () => {
    const s = initSim(ctx, initialDoors(site), 42)
    startFire(ctx, s, site.demo.fireAt)
    let pose2: Pose | null = null
    for (let k = 0; k < 160; k++) {
      if (k === 100) engage(ctx, s)
      tick(ctx, s)
      if (k % 20 === 0) {
        const snap = snapshot(ctx, s)
        pose2 = poseTarget(site, snap, pose2)
        const img = surface(80, 45)
        const cols = renderScene(img, site, snap, pose2!)
        expect(cols).toHaveLength(80)
        expect(Number.isFinite(centre(img, 40, 20)[0])).toBe(true)
      }
    }
  })
})
