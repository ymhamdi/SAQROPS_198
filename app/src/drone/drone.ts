// Simulated reconnaissance drone (the aeronautical element, CLAUDE.md §12). It takes off from the engine, flies a loop
// around the building at a fixed altitude, never enters the no-fly cone over the smoke plume (oriented by the outdoor
// wind), and keeps a battery point of no return with the same logic as the team's air: from every point, the way home
// must still land with the reserve. Flight refused above the wind limit (R7). Its thermal image is shown on the PC
// only and never feeds the verdict (R5).

import { H, v } from '../config.ts'
import type { DataStatus, Point } from '../types.ts'

export interface DroneParams {
  enduranceS: number
  cruiseMs: number
  maxWindMs: number
  reservePct: number
  altitudeM: number
  climbMs: number
  footprintM: number
  loopOffsetM: number
  plumeLengthM: number
  plumeHalfAngleDeg: number
  plumeCoreM: number
}

export function droneParams(): DroneParams {
  const d = H.drone
  return {
    enduranceS: v(d.enduranceMin) * 60,
    cruiseMs: v(d.cruiseMs),
    maxWindMs: v(d.maxWindMs),
    reservePct: v(d.batteryReservePct),
    altitudeM: v(d.altitudeM),
    climbMs: v(d.climbMs),
    footprintM: v(d.footprintM),
    loopOffsetM: v(d.loopOffsetM),
    plumeLengthM: v(d.plumeExclusionLengthM),
    plumeHalfAngleDeg: v(d.plumeExclusionHalfAngleDeg),
    plumeCoreM: v(d.plumeCoreRadiusM),
  }
}

export interface Wind {
  speedMs: number
  /** where the wind blows from, degrees clockwise from north (meteorological convention) */
  fromDeg: number
  status: DataStatus
}

/** No-fly zone: a disc over the fire and a cone downwind of it. */
export interface Plume {
  source: Point
  towardDeg: number
  lengthM: number
  halfAngleDeg: number
  coreM: number
}

/** Bearing from a to b on the plan, degrees clockwise from north (north = −y). */
export function bearingDeg(a: Point, b: Point): number {
  return ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360
}

export function plumeOf(fire: Point, wind: Wind, p: DroneParams): Plume {
  return { source: fire, towardDeg: (wind.fromDeg + 180) % 360, lengthM: p.plumeLengthM, halfAngleDeg: p.plumeHalfAngleDeg, coreM: p.plumeCoreM }
}

export function inPlume(pl: Plume, pt: Point): boolean {
  const d = Math.hypot(pt.x - pl.source.x, pt.y - pl.source.y)
  if (d <= pl.coreM) return true
  if (d > pl.lengthM) return false
  const diff = Math.abs(((bearingDeg(pl.source, pt) - pl.towardDeg + 540) % 360) - 180)
  return diff <= pl.halfAngleDeg
}

/** True when the straight segment a → b passes through the plume (sampled every metre). */
function crossesPlume(pl: Plume | null, a: Point, b: Point): boolean {
  if (!pl) return false
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)))
  for (let k = 0; k <= n; k++) if (inPlume(pl, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return true
  return false
}

/** The loop around a rectangle (site metres), offset outwards, one point every `stepM`. */
export function loopAround(rect: { x0: number; y0: number; x1: number; y1: number }, offsetM: number, stepM = 2): Point[] {
  const x0 = rect.x0 - offsetM
  const y0 = rect.y0 - offsetM
  const x1 = rect.x1 + offsetM
  const y1 = rect.y1 + offsetM
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  const out: Point[] = []
  for (let i = 0; i < 4; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / stepM))
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}

export interface FlightPoint extends Point {
  /** time since take-off, s */
  tS: number
  /** battery left, % */
  batteryPct: number
  /** battery left after flying home from here (headwind assumed) minus the reserve, %; ≥ 0 everywhere by construction */
  marginPct: number
  /** at reconnaissance altitude (not climbing or landing) */
  aloft: boolean
}

export interface Flight {
  ok: boolean
  /** why the flight is refused or cut short; null when flown as planned */
  reason: string | null
  points: FlightPoint[]
  plume: Plume | null
  landedS: number
}

/**
 * Plans the flight: climb at the engine, fly to the loop, go round it as far as the plume allows in both directions,
 * come back and land. Cut at the battery point of no return. Refused if the wind is too strong or the engine is under
 * the plume.
 */
export function planFlight(loop: Point[], home: Point, plume: Plume | null, wind: Wind, p: DroneParams): Flight {
  const refused = (reason: string): Flight => ({ ok: false, reason, points: [], plume, landedS: 0 })
  // R7 fails closed: a comparison with a missing or non-finite wind is false, which would let the flight go.
  if (!Number.isFinite(wind.speedMs) || !Number.isFinite(wind.fromDeg)) return refused('Vol refusé : vent inconnu ou illisible dans le relevé météo')
  if (wind.speedMs > p.maxWindMs) return refused(`Vol refusé : vent ${wind.speedMs.toFixed(1)} m/s au-delà de la limite de ${p.maxWindMs} m/s`)
  if (plume && inPlume(plume, home)) return refused("Vol refusé : l'engin est sous le panache, le déplacer au vent")

  // Start the loop at its point nearest the engine; keep the arcs clear of the plume in both directions.
  let s0 = 0
  loop.forEach((pt, i) => {
    if (Math.hypot(pt.x - home.x, pt.y - home.y) < Math.hypot(loop[s0].x - home.x, loop[s0].y - home.y)) s0 = i
  })
  const n = loop.length
  const at = (k: number) => loop[((s0 + k) % n + n) % n]
  if (plume && (inPlume(plume, at(0)) || crossesPlume(plume, home, at(0)))) return refused('Vol refusé : le panache barre le chemin vers la boucle')
  const forward: Point[] = []
  for (let k = 0; k <= n && !(plume && inPlume(plume, at(k))); k++) forward.push(at(k))
  const fullLoop = forward.length > n
  const backward: Point[] = []
  if (!fullLoop) for (let k = 0; k > -n && !(plume && inPlume(plume, at(k))); k--) backward.push(at(k))

  // Horizontal route at altitude. Each point knows how far home it is along a path known to be clear of the plume:
  // back along the arc it is on, to the loop start, then to the engine.
  const d0 = Math.hypot(at(0).x - home.x, at(0).y - home.y)
  const withBack = (arc: Point[]) => {
    let acc = d0
    return arc.map((pt, k) => {
      if (k > 0) acc += Math.hypot(pt.x - arc[k - 1].x, pt.y - arc[k - 1].y)
      return { pt, backM: acc }
    })
  }
  const fwd = withBack(forward)
  const bwd = withBack(backward)
  const route: { pt: Point; backM: number }[] = [{ pt: home, backM: 0 }, ...fwd]
  if (!fullLoop) route.push(...[...fwd].reverse().slice(1), ...bwd.slice(1), ...[...bwd].reverse().slice(1))
  route.push({ pt: home, backM: 0 })

  const rate = 100 / p.enduranceS
  const climbS = p.altitudeM / p.climbMs
  const homeSpeed = Math.max(0.5, p.cruiseMs - wind.speedMs) // way home flown into a headwind, conservatively
  const points: FlightPoint[] = []
  let t = 0
  const push = (pt: Point, backM: number, aloft: boolean) => {
    const direct = Math.hypot(pt.x - home.x, pt.y - home.y)
    const homeM = crossesPlume(plume, pt, home) ? backM : Math.min(direct, backM)
    // On the ground (before take-off, after landing) there is no way home left to fly.
    const returnS = aloft ? homeM / homeSpeed + climbS : 0
    const battery = 100 - t * rate
    points.push({ x: pt.x, y: pt.y, tS: t, batteryPct: battery, marginPct: battery - returnS * rate - p.reservePct, aloft })
  }
  push(home, 0, false)
  t += climbS
  push(home, 0, true)
  let reason: string | null = fullLoop ? null : 'Boucle partielle : le panache barre une partie du tour (aller-retour de chaque côté)'
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1].pt
    const b = route[i].pt
    t += Math.hypot(b.x - a.x, b.y - a.y) / p.cruiseMs
    push(b, route[i].backM, true)
    const last = points[points.length - 1]
    if (last.marginPct < 0 && i < route.length - 1) {
      // Battery point of no return: drop this point and go home from the previous one by its clear path.
      points.pop()
      const prev = points[points.length - 1]
      const back = route[i - 1].backM
      const direct = Math.hypot(home.x - prev.x, home.y - prev.y)
      t = prev.tS + (crossesPlume(plume, prev, home) ? back : Math.min(direct, back)) / homeSpeed
      push(home, 0, true)
      reason = 'Retour anticipé : point de non-retour batterie'
      break
    }
  }
  t += climbS
  push(home, 0, false)
  return { ok: true, reason, points, plume, landedS: t }
}

/** Where the drone is at a time since take-off (interpolated), and its battery. */
export function droneAt(f: Flight, tS: number): FlightPoint | null {
  if (!f.ok || f.points.length === 0) return null
  if (tS >= f.landedS) return f.points[f.points.length - 1]
  let i = 0
  while (i + 1 < f.points.length && f.points[i + 1].tS <= tS) i++
  const a = f.points[i]
  const b = f.points[Math.min(i + 1, f.points.length - 1)]
  const k = b.tS > a.tS ? (tS - a.tS) / (b.tS - a.tS) : 0
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tS, batteryPct: a.batteryPct + (b.batteryPct - a.batteryPct) * k, marginPct: Math.min(a.marginPct, b.marginPct), aloft: a.aloft && b.aloft }
}
