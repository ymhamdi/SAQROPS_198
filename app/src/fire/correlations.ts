// Fire-engineering correlations used by the engine. Each one is cited here and in data/SOURCES.md; every coefficient
// comes from data/config.json through FireParams (R4). Pure functions, SI units with kW for heat release.

import type { FireParams, WallProps } from './params.ts'

const G = 9.81
const K0 = 273.15

/** t-squared growth Q = α·t² (NFPA 72 Annex B; SFPE Handbook, design fires), kW. */
export function tSquaredKw(alpha: number, sinceIgnitionS: number): number {
  return sinceIgnitionS <= 0 ? 0 : alpha * sinceIgnitionS * sinceIgnitionS
}

/** A measured heat-release curve, linearly interpolated, 0 before the start and held at its last value after. */
export function curveKw(curve: { t: number[]; q: number[] }, sinceIgnitionS: number): number {
  const { t, q } = curve
  if (sinceIgnitionS <= t[0]) return sinceIgnitionS < 0 ? 0 : q[0]
  for (let i = 1; i < t.length; i++) {
    if (sinceIgnitionS <= t[i]) return q[i - 1] + ((q[i] - q[i - 1]) * (sinceIgnitionS - t[i - 1])) / (t[i] - t[i - 1])
  }
  return q[q.length - 1]
}

/** Ventilation-limited heat release Q = 1500·Σ A·√H (Kawagoe 1958; SFPE Handbook), kW. */
export function ventilationLimitKw(p: FireParams, aSqrtH: number): number {
  return p.ventK * aSqrtH
}

/**
 * Effective heat transfer coefficient of the walls, kW/(m²·K) (SFPE Handbook, Walton & Thomas): √(kρc/t) while the
 * heat has not crossed the wall (t < tp = (ρc/k)(δ/2)²), k/δ after.
 */
export function wallHkKw(w: WallProps, heatingS: number): number {
  const tp = ((w.rho * w.c) / w.k) * (w.delta / 2) ** 2
  const hk = heatingS < tp ? Math.sqrt((w.k * w.rho * w.c) / Math.max(heatingS, 1)) : w.k / w.delta
  return hk / 1000
}

/**
 * Hot-layer temperature rise, K: ΔT = 6.85·(Q²/(A·√H·hk·AT))^(1/3) (McCaffrey, Quintiere & Harkleroad 1981, Fire
 * Technology 17(2):98-119). Q in kW, A·√H in m^(5/2), hk in kW/(m²·K), AT in m².
 */
export function mqhRiseK(p: FireParams, qKw: number, aSqrtH: number, hk: number, surfaceM2: number): number {
  if (qKw <= 0) return 0
  return p.mqhK * Math.cbrt((qKw * qKw) / (aSqrtH * hk * surfaceM2))
}

/** Thomas (1981) minimum heat release for flashover, kW: 7.8·AT + 378·A·√H. */
export function thomasFlashoverKw(p: FireParams, surfaceM2: number, aSqrtH: number): number {
  return p.thomasA * surfaceM2 + p.thomasV * aSqrtH
}

/** Mean flame height for a fire of unknown diameter, m: L = 0.166·Qc^(2/5) (NFPA 92, 2018). */
export function flameHeightM(p: FireParams, qcKw: number): number {
  return qcKw <= 0 ? 0 : p.flameK * qcKw ** 0.4
}

/**
 * Smoke mass flow of an axisymmetric plume at height z above the fire, kg/s (Heskestad; NFPA 92, 2018, eq. 5.5.1.1):
 * 0.071·Qc^(1/3)·z^(5/3) + 0.0018·Qc above the flame, 0.032·Qc^(3/5)·z within it.
 */
export function plumeMassKgS(p: FireParams, qcKw: number, zM: number): number {
  if (qcKw <= 0 || zM <= 0) return 0
  const l = flameHeightM(p, qcKw)
  return zM > l ? p.plumeK1 * Math.cbrt(qcKw) * zM ** (5 / 3) + p.plumeK2 * qcKw : p.plumeK3 * qcKw ** 0.6 * zM
}

/** Gas density from its temperature, kg/m³ (ideal gas, ρT = 353). */
export function densityKgM3(p: FireParams, tempC: number): number {
  return p.rhoT / (tempC + K0)
}

/**
 * Hot-gas outflow through a doorway when the hot layer is below the soffit, kg/s (Karlsson & Quintiere 2000, ch. 10):
 * (2/3)·Cd·W·ρg·√(2g(Tg/Ta − 1))·(Hd − z)^(3/2), with the neutral plane taken at the layer interface z.
 */
export function doorOutflowKgS(p: FireParams, layerC: number, ambientC: number, widthM: number, doorTopM: number, layerZM: number): number {
  const depth = doorTopM - layerZM
  if (depth <= 0 || layerC <= ambientC) return 0
  const rhoG = densityKgM3(p, layerC)
  return (2 / 3) * p.cd * widthM * rhoG * Math.sqrt(2 * G * ((layerC + K0) / (ambientC + K0) - 1)) * depth ** 1.5
}

/**
 * Ceiling-jet temperature rise at radius r under a ceiling H above the fire, K (Alpert 1972, Fire Technology
 * 8(3):181-195): 16.9·Q^(2/3)/H^(5/3) for r/H ≤ 0.18, 5.38·(Q/r)^(2/3)/H beyond.
 */
export function alpertRiseK(p: FireParams, qKw: number, ceilingM: number, rM: number): number {
  if (qKw <= 0) return 0
  return rM / ceilingM <= p.det.alpertTempRatio
    ? (p.det.alpertNearK * qKw ** (2 / 3)) / ceilingM ** (5 / 3)
    : (p.det.alpertFarK * (qKw / rM) ** (2 / 3)) / ceilingM
}

/** Ceiling-jet velocity, m/s (Alpert 1972): 0.96·(Q/H)^(1/3) for r/H ≤ 0.15, 0.195·Q^(1/3)·H^(1/2)/r^(5/6) beyond. */
export function alpertVelocityMs(p: FireParams, qKw: number, ceilingM: number, rM: number): number {
  if (qKw <= 0) return 0
  return rM / ceilingM <= p.det.alpertVelRatio
    ? p.det.alpertVelNearK * Math.cbrt(qKw / ceilingM)
    : (p.det.alpertVelFarK * Math.cbrt(qKw) * Math.sqrt(ceilingM)) / rM ** (5 / 6)
}

/**
 * Heat-detector element temperature after dt, °C: dTe/dt = √u·(Tg − Te)/RTI, integrated exactly over the step
 * (SFPE Handbook, detector response; Heskestad & Smith RTI model).
 */
export function detectorElementC(elementC: number, gasC: number, uMs: number, rti: number, dtS: number): number {
  return gasC + (elementC - gasC) * Math.exp((-Math.sqrt(uMs) * dtS) / rti)
}
