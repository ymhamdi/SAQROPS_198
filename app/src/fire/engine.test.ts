import { describe, expect, test } from 'vitest'
import { buildSite } from '../site/site'
import { alpertRiseK, mqhRiseK, plumeMassKgS, thomasFlashoverKw, tSquaredKw, ventilationLimitKw, wallHkKw } from './correlations'
import { ignite, initFireState, setDoor, stepFire, type FireSetup } from './engine'
import { defaultFireParams } from './params'
import { fireSetupOf, initialDoors } from './siteSetup'

const p = defaultFireParams()

/** Two rooms joined by one door, the first also open to the outside: the minimal case for spread and doors. */
function twoRooms(): FireSetup {
  const room = { floorM2: 16, heightM: 2.4, surfaceM2: 2 * 16 + 4 * 4 * 2.4, walls: 'gypsum' as const, flashoverModel: true, growth: 'fast' as const }
  return {
    rooms: [room, { ...room }],
    doors: [
      { rooms: [0, 1], widthM: 0.9, heightM: 2.0, at: { x: 4, y: 2 } },
      { rooms: [0, -1], widthM: 0.9, heightM: 2.0, at: { x: 0, y: 2 } },
    ],
    detectors: [
      { room: 0, at: { x: 2, y: 2 } },
      { room: 1, at: { x: 6, y: 2 } },
    ],
  }
}

function run(setup: FireSetup, doors: boolean[], seconds: number, onStep?: (s: ReturnType<typeof initFireState>) => void) {
  const s = initFireState(setup, p, doors, 7)
  ignite(s, 0, { x: 2, y: 2 })
  for (let k = 0; k < seconds; k++) {
    stepFire(setup, p, s, 1)
    onStep?.(s)
  }
  return s
}

describe('correlations: textbook values', () => {
  test('t² fire: fast growth reaches 1055 kW at 150 s (NFPA 72)', () => {
    expect(tSquaredKw(p.alpha.fast, 150)).toBeCloseTo(1055, -1)
    expect(tSquaredKw(p.alpha.slow, 600)).toBeCloseTo(1055, -1)
  })

  test('Thomas: the ISO 9705 room (3.6 × 2.4 × 2.4 m, 0.8 × 2.0 m door) flashes over near 1.2 MW', () => {
    const aSqrtH = 0.8 * 2.0 * Math.sqrt(2.0)
    const surface = 2 * 3.6 * 2.4 + 2 * (3.6 + 2.4) * 2.4 - 0.8 * 2.0
    const q = thomasFlashoverKw(p, surface, aSqrtH)
    expect(q).toBeGreaterThan(1000)
    expect(q).toBeLessThan(1400)
  })

  test('ventilation limit of a 0.8 × 2.0 m door: 1500·A·√H ≈ 3.4 MW', () => {
    expect(ventilationLimitKw(p, 0.8 * 2.0 * Math.sqrt(2.0))).toBeCloseTo(3394, -1)
  })

  test('MQH: 1 MW in the ISO 9705 room after 5 min gives a hot layer of several hundred °C', () => {
    const aSqrtH = 0.8 * 2.0 * Math.sqrt(2.0)
    const surface = 2 * 3.6 * 2.4 + 2 * (3.6 + 2.4) * 2.4 - 0.8 * 2.0
    const rise = mqhRiseK(p, 1000, aSqrtH, wallHkKw(p.walls.gypsum, 300), surface)
    expect(rise).toBeGreaterThan(400)
    expect(rise).toBeLessThan(900)
  })

  test('wall heat loss falls with time while the heat soaks in, then holds at k/δ', () => {
    expect(wallHkKw(p.walls.concrete, 60)).toBeGreaterThan(wallHkKw(p.walls.concrete, 600))
    const g = p.walls.gypsum
    expect(wallHkKw(g, 1e6)).toBeCloseTo(g.k / g.delta / 1000, 9)
  })

  test('Alpert: 1 MW under a 4 m ceiling, 1 m off the axis: ΔT = 5.38·(Q/r)^(2/3)/H ≈ 134 K', () => {
    expect(alpertRiseK(p, 1000, 4, 1)).toBeCloseTo(134.5, 0)
  })

  test('plume: entrainment grows with height and with the fire', () => {
    expect(plumeMassKgS(p, 700, 3)).toBeGreaterThan(plumeMassKgS(p, 700, 1.5))
    expect(plumeMassKgS(p, 1400, 3)).toBeGreaterThan(plumeMassKgS(p, 700, 3))
    // 1 MW fire (Qc = 700 kW), 3 m up: 0.071·700^(1/3)·3^(5/3) + 0.0018·700 ≈ 5.2 kg/s (Heskestad / NFPA 92)
    expect(plumeMassKgS(p, 700, 3)).toBeCloseTo(5.19, 1)
  })
})

describe('engine', () => {
  test('monotone before flashover: heat release and hot layer rise, the layer comes down', () => {
    let prev = { q: 0, t: p.ambientC, z: Infinity }
    run(twoRooms(), [true, true], 400, (s) => {
      const r = s.rooms[0]
      if (r.flashedAt !== null) return
      expect(r.qKw).toBeGreaterThanOrEqual(prev.q - 1e-9)
      expect(r.layerC).toBeGreaterThanOrEqual(prev.t - 1e-9)
      expect(r.layerZ).toBeLessThanOrEqual(prev.z + 1e-9)
      prev = { q: r.qKw, t: r.layerC, z: r.layerZ }
    })
  })

  test('smoke filling within a factor 2 of NFPA 92 for a steady fire in a large closed hall', () => {
    // NFPA 92 (2018) eq. 5.4.2.1: z/H = 1.11 − 0.28·ln(t·Q^(1/3)·H^(−4/3)/(A/H²)); time for z/H = 0.5.
    const H = 10
    const A = 900
    const Q = 1000
    const nfpaT = (Math.exp((1.11 - 0.5) / 0.28) * (A / H ** 2)) / (Q ** (1 / 3) * H ** (-4 / 3))
    const setup: FireSetup = {
      rooms: [{ floorM2: A, heightM: H, surfaceM2: 2 * A + 4 * 30 * H, walls: 'concrete', flashoverModel: false, growth: 'medium', curve: { t: [0, 1e6], q: [Q, Q] } }],
      doors: [],
      detectors: [],
    }
    const s = initFireState(setup, p, [], 1)
    ignite(s, 0, { x: 0, y: 0 })
    let tHalf = Infinity
    for (let k = 0; k < 3000 && tHalf === Infinity; k++) {
      stepFire(setup, p, s, 1)
      if (s.rooms[0].layerZ <= H / 2) tHalf = s.t
    }
    expect(tHalf).toBeGreaterThan(nfpaT / 2)
    expect(tHalf).toBeLessThan(nfpaT * 2)
  })

  test('a closed door delays (here prevents) the spread to the next room', () => {
    const open = run(twoRooms(), [true, true], 900)
    const shut = run(twoRooms(), [false, true], 900)
    expect(open.rooms[0].flashedAt).not.toBeNull()
    expect(open.rooms[1].ignitedAt).not.toBeNull()
    expect(shut.rooms[1].ignitedAt).toBeNull()
  })

  test('closing the door mid-fire slows the next room down', () => {
    const setup = twoRooms()
    const open = run(setup, [true, true], 200)
    const s = initFireState(setup, p, [true, true], 7)
    ignite(s, 0, { x: 2, y: 2 })
    for (let k = 0; k < 200; k++) {
      if (k === 60) setDoor(s, 0, false)
      stepFire(setup, p, s, 1)
    }
    expect(s.rooms[1].layerC).toBeLessThan(open.rooms[1].layerC)
  })

  test('a detector fails above 150 °C and stays failed', () => {
    let failedAt = -1
    run(twoRooms(), [true, true], 600, (s) => {
      const d = s.detectors[0]
      if (failedAt < 0 && d.failed) failedAt = s.t
      if (failedAt >= 0) {
        expect(d.failed).toBe(true)
        expect(d.reading).toBeNaN()
      } else expect(d.reading).toBeLessThanOrEqual(p.det.failureC)
    })
    expect(failedAt).toBeGreaterThan(0)
  })

  test('the same seed gives the same readings', () => {
    const a = run(twoRooms(), [true, true], 120)
    const b = run(twoRooms(), [true, true], 120)
    expect(a.detectors.map((d) => d.reading)).toEqual(b.detectors.map((d) => d.reading))
  })
})

describe('demo scenario on the workshop', () => {
  test('solvent store flashes over, then the paint booth; the booth detectors fail before its flashover', () => {
    const site = buildSite()
    const setup = fireSetupOf(site)
    const s = initFireState(setup, p, initialDoors(site), 42)
    ignite(s, site.demo.fireRoom, site.demo.fireAt)
    const booth = site.rooms.findIndex((r) => r.id === 'peinture')
    const boothDets = site.detectors.flatMap((d, i) => (d.room === booth ? [i] : []))
    let boothFailedAt = Infinity
    for (let k = 0; k < 600; k++) {
      stepFire(setup, p, s, 1)
      if (boothFailedAt === Infinity && boothDets.every((i) => s.detectors[i].failed)) boothFailedAt = s.t
    }
    const store = s.rooms[site.demo.fireRoom].flashedAt!
    const boothFo = s.rooms[booth].flashedAt!
    expect(store).toBeGreaterThan(60)
    expect(boothFo).toBeGreaterThan(store)
    expect(boothFailedAt).toBeLessThan(boothFo)
    expect(boothFo).toBeLessThan(420) // inside the 1-minute video at ×10
  })
})
