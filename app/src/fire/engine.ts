// The fire engine: one zone per room (a hot layer over cool air), 1 s steps. ONE engine for the app and the dataset
// (CLAUDE.md §5). Pure TypeScript with .ts imports: ml/generate.ts runs it under Node.
//
// Per step: heat release (t² growth or a measured curve, capped by the ventilation through the open doors), hot-gas
// flows through open doors, hot-layer temperature (MQH) and descent (plume entrainment), flashover (600 °C or
// Thomas), spread to the next room through an open door after flashover (or a closed door once its rating is spent),
// and ceiling heat detectors (Alpert ceiling jet or hot layer, RTI lag, noise, failure above 150 °C).
// Everything it computes is SIMULATED truth: the verdict never reads it (R5), only the detector readings.

import {
  alpertRiseK,
  alpertVelocityMs,
  curveKw,
  densityKgM3,
  detectorElementC,
  doorOutflowKgS,
  mqhRiseK,
  plumeMassKgS,
  thomasFlashoverKw,
  tSquaredKw,
  ventilationLimitKw,
  wallHkKw,
} from './correlations.ts'
import type { FireParams, GrowthName } from './params.ts'

export interface Pt {
  x: number
  y: number
}

export interface RoomGeom {
  floorM2: number
  heightM: number
  surfaceM2: number
  walls: 'concrete' | 'gypsum'
  /** room-sized compartments only; the hall gets smoke and temperature but never flashes over */
  flashoverModel: boolean
  growth: GrowthName
  /** a measured heat-release curve (NIST FCD) instead of the t² growth */
  curve?: { t: number[]; q: number[] } | null
}

export interface DoorGeom {
  /** the two sides; -1 = outside */
  rooms: [number, number]
  widthM: number
  heightM: number
  at: Pt
}

export interface DetectorGeom {
  room: number
  at: Pt
}

export interface FireSetup {
  rooms: RoomGeom[]
  doors: DoorGeom[]
  detectors: DetectorGeom[]
}

export interface RoomState {
  ignitedAt: number | null
  fireAt: Pt | null
  /** heat release now, kW */
  qKw: number
  layerC: number
  /** hot-layer interface height above the floor, m (= ceiling height when there is no layer) */
  layerZ: number
  heatingSince: number | null
  flashedAt: number | null
}

export interface DetectorState {
  elementC: number
  failed: boolean
  /** what the detector reports, °C; NaN once failed */
  reading: number
}

export interface FireState {
  t: number
  rooms: RoomState[]
  doorOpen: boolean[]
  /** per door and direction (2·door + 0: rooms[0] → rooms[1], + 1: the reverse): exposure time towards spreading, s */
  spreadOpenS: number[]
  spreadClosedS: number[]
  detectors: DetectorState[]
  seed: number
}

/** Mulberry32: small, fast, seedable; the same sequence in the app and the generator. */
function nextRandom(state: FireState): number {
  let a = (state.seed = (state.seed + 0x6d2b79f5) | 0)
  a = Math.imul(a ^ (a >>> 15), a | 1)
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61)
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296
}

function gauss(state: FireState): number {
  const u = Math.max(nextRandom(state), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * nextRandom(state))
}

export function initFireState(setup: FireSetup, p: FireParams, doorOpen: boolean[], seed: number): FireState {
  return {
    t: 0,
    rooms: setup.rooms.map((r) => ({ ignitedAt: null, fireAt: null, qKw: 0, layerC: p.ambientC, layerZ: r.heightM, heatingSince: null, flashedAt: null })),
    doorOpen: [...doorOpen],
    spreadOpenS: new Array(setup.doors.length * 2).fill(0),
    spreadClosedS: new Array(setup.doors.length * 2).fill(0),
    detectors: setup.detectors.map(() => ({ elementC: p.ambientC, failed: false, reading: p.ambientC })),
    seed: seed | 0,
  }
}

export function ignite(state: FireState, room: number, at: Pt): void {
  const r = state.rooms[room]
  if (r.ignitedAt !== null) return
  r.ignitedAt = state.t
  r.fireAt = at
}

export function setDoor(state: FireState, door: number, open: boolean): void {
  state.doorOpen[door] = open
}

/** A·√H of each room's openings: its open doors plus a little leakage, m^(5/2). */
export function openingFactors(setup: FireSetup, p: FireParams, state: FireState): number[] {
  const out = setup.rooms.map((r) => p.leakagePerM2 * r.floorM2 * Math.sqrt(r.heightM))
  setup.doors.forEach((d, i) => {
    if (!state.doorOpen[i]) return
    const f = d.widthM * d.heightM * Math.sqrt(d.heightM)
    for (const r of d.rooms) if (r >= 0) out[r] += f
  })
  return out
}

export function stepFire(setup: FireSetup, p: FireParams, state: FireState, dt = 1): void {
  const amb = p.ambientC
  const n = setup.rooms.length
  const aSqrtH = openingFactors(setup, p, state)
  const t = state.t + dt

  // 1. Heat release. A ventilation-limited room cannot burn all its fuel inside: the excess burns as a door jet in the
  // rooms beyond its open doors (CFAST door jet fires), shared by each door's A·√H.
  const inMass = new Array<number>(n).fill(0)
  const inEnthalpy = new Array<number>(n).fill(0)
  const outMass = new Array<number>(n).fill(0)
  const jetKw = new Array<number>(n).fill(0)
  setup.rooms.forEach((g, i) => {
    const r = state.rooms[i]
    if (r.ignitedAt === null) return
    const since = t - r.ignitedAt
    const free = g.curve ? curveKw(g.curve, since) : tSquaredKw(p.alpha[g.growth], since)
    const vent = ventilationLimitKw(p, aSqrtH[i])
    r.qKw = r.flashedAt !== null ? vent : Math.min(free, vent)
    const excess = p.doorJetFraction * Math.max(0, free - vent)
    if (excess <= 0) return
    setup.doors.forEach((d, k) => {
      if (!state.doorOpen[k] || (d.rooms[0] !== i && d.rooms[1] !== i)) return
      const other = d.rooms[0] === i ? d.rooms[1] : d.rooms[0]
      if (other >= 0) jetKw[other] += (excess * d.widthM * d.heightM * Math.sqrt(d.heightM)) / aSqrtH[i]
    })
  })
  for (let i = 0; i < n; i++) inEnthalpy[i] += jetKw[i]

  // 2. Hot gas through open doors, from the layers of the last step.
  setup.doors.forEach((d, i) => {
    if (!state.doorOpen[i]) return
    for (let s = 0; s < 2; s++) {
      const src = d.rooms[s]
      const dst = d.rooms[1 - s]
      if (src < 0) continue
      const r = state.rooms[src]
      const m = doorOutflowKgS(p, r.layerC, amb, d.widthM, d.heightM, r.layerZ)
      if (m <= 0) continue
      outMass[src] += m
      if (dst >= 0) {
        inMass[dst] += m
        inEnthalpy[dst] += m * p.cp * (r.layerC - amb)
      }
    }
  })

  // 3. Hot layer of each room: temperature (MQH, followed with a lag) and interface height (mass balance).
  setup.rooms.forEach((g, i) => {
    const r = state.rooms[i]
    const qEff = r.qKw + inEnthalpy[i]
    if (qEff > 0 && r.heatingSince === null) r.heatingSince = state.t
    let target = amb
    if (r.flashedAt !== null) target = p.postFlashoverC
    else if (r.heatingSince !== null && qEff > 0) {
      const hk = wallHkKw(p.walls[g.walls], t - r.heatingSince)
      target = Math.min(amb + mqhRiseK(p, qEff, aSqrtH[i], hk, g.surfaceM2), p.postFlashoverC)
    }
    r.layerC += (target - r.layerC) * (1 - Math.exp(-dt / p.layerResponseS))
    const plume = r.qKw > 0 ? plumeMassKgS(p, p.chi * r.qKw, r.layerZ) : 0
    const net = plume + inMass[i] - outMass[i]
    r.layerZ -= (net / (densityKgM3(p, r.layerC) * g.floorM2)) * dt
    r.layerZ = Math.min(g.heightM, Math.max(0.1, r.layerZ))
    if (r.layerC <= amb + 0.5 && net <= 0) r.layerZ = g.heightM

    // 4. Flashover.
    if (g.flashoverModel && r.ignitedAt !== null && r.flashedAt === null) {
      const byTemp = r.layerC >= p.flashoverC
      const byThomas = r.qKw >= thomasFlashoverKw(p, g.surfaceM2, aSqrtH[i])
      const hit = p.criterion === 'temperature' ? byTemp : p.criterion === 'thomas' ? byThomas : byTemp || byThomas
      if (hit) r.flashedAt = t
    }
  })

  // 5. Spread to the next room after a flashover: through an open door, or a closed one once its rating is spent.
  setup.doors.forEach((d, i) => {
    for (let s = 0; s < 2; s++) {
      const src = d.rooms[s]
      const dst = d.rooms[1 - s]
      if (src < 0 || dst < 0 || state.rooms[src].flashedAt === null || state.rooms[dst].ignitedAt !== null) continue
      const k = 2 * i + s
      if (state.doorOpen[i]) state.spreadOpenS[k] += dt
      else state.spreadClosedS[k] += dt
      if (state.spreadOpenS[k] >= p.spreadDelayS || state.spreadClosedS[k] >= p.doorFireResistanceS) {
        state.t = t // the new fire starts now
        ignite(state, dst, d.at)
        state.rooms[dst].ignitedAt = t
      }
    }
  })

  // 6. Ceiling heat detectors.
  setup.detectors.forEach((det, k) => {
    const s = state.detectors[k]
    if (s.failed) return
    const g = setup.rooms[det.room]
    const r = state.rooms[det.room]
    let gas = r.layerZ < g.heightM - 0.05 ? Math.max(amb, r.layerC) : amb
    let u = p.det.minU
    if (r.qKw > 0 && r.fireAt) {
      const dist = Math.max(0.1, Math.hypot(det.at.x - r.fireAt.x, det.at.y - r.fireAt.y))
      gas = Math.max(gas, amb + alpertRiseK(p, r.qKw, g.heightM, dist))
      u = Math.max(u, alpertVelocityMs(p, r.qKw, g.heightM, dist))
    }
    s.elementC = detectorElementC(s.elementC, gas, u, p.det.rti, dt)
    const reading = s.elementC + gauss(state) * p.det.noiseSdC
    if (reading > p.det.failureC) {
      s.failed = true
      s.reading = NaN
    } else s.reading = reading
  })

  state.t = t
}
