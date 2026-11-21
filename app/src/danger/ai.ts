// The model's view of each room, turned into reasons and route-cost multipliers. Inputs are detector statistics only
// (R5); the reasons it produces can only be added to the rules' (R1, danger/merge.ts).

import { H, v } from '../config.ts'
import { featureVector, type RoomStats } from '../ml/features.ts'
import type { Predictor } from '../ml/predict.ts'
import { neighbours, type Site } from '../site/site.ts'
import { worstStatus } from '../stats/status.ts'
import type { Reason } from '../stats/verdict.ts'
import type { DataStatus } from '../types.ts'

export interface RoomPrediction {
  room: number
  p30: number
  p60: number
  tffS: number
  /** above a decision threshold (chosen for recall ≥ 0.95 on validation) */
  alert: boolean
  status: DataStatus
}

/** Predictions for the rooms the flashover model covers (room-sized compartments). */
export function predictRooms(site: Site, stats: RoomStats[], predictor: Predictor, readingsStatus: DataStatus): RoomPrediction[] {
  // A model trained on CFAST simulations (MODELED) fed with simulated readings in the demo: never better than either.
  const status = worstStatus('MODELED', readingsStatus)
  return site.rooms
    .filter((r) => r.flashoverModel)
    .map((r) => {
      const row = featureVector(stats[r.index], neighbours(site, r.index).map((n) => stats[n]))
      const p = predictor.predict(row)
      return { room: r.index, ...p, alert: p.p30 >= predictor.thresholds.p30 || p.p60 >= predictor.thresholds.p60, status }
    })
}

/** "~45 s", rounded to 5 s: the model is not more precise than that. */
export function roughSeconds(s: number): string {
  return `~${Math.max(5, Math.round(s / 5) * 5)} s`
}

/**
 * Reasons from the predictions. A predicted flashover in a room the team is in, will cross, or works in is NO-GO;
 * elsewhere it is a caution. `involved` = room indices on the rest of the plan.
 */
export function aiReasons(site: Site, predictions: RoomPrediction[], involved: Set<number>, dummy: boolean): Reason[] {
  const out: Reason[] = []
  for (const p of predictions) {
    if (!p.alert) continue
    const name = site.rooms[p.room].name
    const onPlan = involved.has(p.room)
    out.push({
      code: 'FLASHOVER_PREDICTED',
      severity: onPlan ? 'no-go' : 'caution',
      message: `Embrasement prévu ${name} dans ${roughSeconds(p.tffS)}${onPlan ? '' : ' (hors itinéraire)'}`,
      source: 'ai',
      status: p.status,
      room: p.room,
    })
  }
  if (dummy) out.push({ code: 'MODEL_DUMMY', severity: 'info', message: 'Modèle IA factice : format seulement, ses prédictions ne valent rien', source: 'ai', status: 'MOCK' })
  return out
}

/** Route-cost multiplier from a prediction: avoid rooms expected to flash over. */
export function aiMultiplier(p: RoomPrediction | undefined): number {
  return p?.alert ? v(H.danger.predictedFlashoverCostMultiplier) : 1
}
