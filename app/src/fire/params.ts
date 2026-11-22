// The engine's parameters, read from data/config.json (R4). The dataset generator may override some of them to
// randomise scenarios; the app always uses defaultFireParams().

import { H, v } from '../config.ts'

export interface WallProps {
  /** W/(m·K) */
  k: number
  /** kg/m³ */
  rho: number
  /** J/(kg·K) */
  c: number
  /** m */
  delta: number
}

export type GrowthName = 'slow' | 'medium' | 'fast' | 'ultraFast'

export interface FireParams {
  alpha: Record<GrowthName, number>
  ventK: number
  mqhK: number
  flashoverC: number
  criterion: 'temperature' | 'thomas' | 'either'
  thomasA: number
  thomasV: number
  postFlashoverC: number
  chi: number
  plumeK1: number
  plumeK2: number
  plumeK3: number
  flameK: number
  cd: number
  cp: number
  rhoT: number
  walls: Record<'concrete' | 'gypsum', WallProps>
  leakagePerM2: number
  doorJetFraction: number
  spreadDelayS: number
  doorFireResistanceS: number
  layerResponseS: number
  ambientC: number
  det: {
    failureC: number
    noiseSdC: number
    rti: number
    minU: number
    alpertNearK: number
    alpertFarK: number
    alpertTempRatio: number
    alpertVelNearK: number
    alpertVelFarK: number
    alpertVelRatio: number
  }
}

export function defaultFireParams(): FireParams {
  const f = H.fire
  const d = H.detectors
  return {
    alpha: { slow: v(f.alphaSlow), medium: v(f.alphaMedium), fast: v(f.alphaFast), ultraFast: v(f.alphaUltraFast) },
    ventK: v(f.ventilationLimitKwPerM52),
    mqhK: v(f.mqhCoefficient),
    flashoverC: v(f.flashoverC),
    criterion: v(f.flashoverCriterion) as FireParams['criterion'],
    thomasA: v(f.thomasAreaKwPerM2),
    thomasV: v(f.thomasVentKwPerM52),
    postFlashoverC: v(f.postFlashoverC),
    chi: v(f.convectiveFraction),
    plumeK1: v(f.plumeK1),
    plumeK2: v(f.plumeK2),
    plumeK3: v(f.plumeFlameK),
    flameK: v(f.flameHeightK),
    cd: v(f.doorDischargeCoefficient),
    cp: v(f.airCpKjPerKgK),
    rhoT: v(f.rhoTKgKPerM3),
    walls: {
      concrete: { k: v(f.concreteConductivityWPerMK), rho: v(f.concreteDensityKgPerM3), c: v(f.concreteHeatCapacityJPerKgK), delta: v(f.concreteThicknessM) },
      gypsum: { k: v(f.gypsumConductivityWPerMK), rho: v(f.gypsumDensityKgPerM3), c: v(f.gypsumHeatCapacityJPerKgK), delta: v(f.gypsumThicknessM) },
    },
    leakagePerM2: v(f.leakageAreaM2PerM2Floor),
    doorJetFraction: v(f.doorJetFraction),
    spreadDelayS: v(f.spreadDelayS),
    doorFireResistanceS: v(f.doorFireResistanceS),
    layerResponseS: v(f.layerResponseS),
    ambientC: v(f.ambientC),
    det: {
      failureC: v(d.failureC),
      noiseSdC: v(d.noiseSdC),
      rti: v(d.rtiMs05),
      minU: v(d.minGasVelocityMs),
      alpertNearK: v(d.alpertNearK),
      alpertFarK: v(d.alpertFarK),
      alpertTempRatio: v(d.alpertTempRatio),
      alpertVelNearK: v(d.alpertVelNearK),
      alpertVelFarK: v(d.alpertVelFarK),
      alpertVelRatio: v(d.alpertVelRatio),
    },
  }
}
