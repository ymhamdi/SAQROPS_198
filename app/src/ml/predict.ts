// Loads the three XGBoost models of ml/model/ (contract.json) and predicts, for one room's feature row:
// P(flashover ≤ 30 s), P(flashover ≤ 60 s) and the time to flashover. Model files are read as text (?raw) so the
// type checker does not have to infer types from megabytes of trees.

import contract from '../../../ml/model/contract.json' with { type: 'json' }
import metrics from '../../../ml/model/metrics.json' with { type: 'json' }
import raw30 from '../../../ml/model/model-30s.json?raw'
import raw60 from '../../../ml/model/model-60s.json?raw'
import rawTff from '../../../ml/model/model-tff.json?raw'
import { H, v } from '../config'
import { DEFAULT_THRESHOLD_RULE } from './thresholdRule'
import { parseXgb, predict, type XgbModel } from './xgb'

export interface Prediction {
  p30: number
  p60: number
  /** seconds to flashover, capped at contract.tffCapS */
  tffS: number
}

export interface Predictor {
  predict(row: number[]): Prediction
  thresholds: { p30: number; p60: number }
  /** a placeholder model (ml/make_dummy.py): its numbers mean nothing and the interface says so */
  dummy: boolean
  /** what the model was trained on, for the interface */
  trainedOn: string
  /** how its thresholds were chosen, for the interface (metrics.json thresholdRule) */
  thresholdRule?: string
}

interface Metrics {
  status?: string
  trainedOn?: string
  thresholds?: { p30?: number; p60?: number }
  thresholdRule?: string
}

export function makePredictor(models: { p30: XgbModel; p60: XgbModel; tff: XgbModel }, m: Metrics): Predictor {
  const fallback = v(H.danger.fallbackThreshold)
  const cap = contract.tffCapS
  return {
    predict: (row) => ({
      p30: predict(models.p30, row),
      p60: predict(models.p60, row),
      tffS: Math.min(cap, Math.max(0, predict(models.tff, row))),
    }),
    thresholds: { p30: m.thresholds?.p30 ?? fallback, p60: m.thresholds?.p60 ?? fallback },
    dummy: m.status === 'DUMMY',
    trainedOn: m.trainedOn ?? (m.status === 'DUMMY' ? 'modèle factice (format seulement)' : 'inconnu'),
    thresholdRule: m.thresholdRule ?? DEFAULT_THRESHOLD_RULE,
  }
}

/** The models shipped in ml/model/. */
export function loadPredictor(): Predictor {
  return makePredictor({ p30: parseXgb(JSON.parse(raw30)), p60: parseXgb(JSON.parse(raw60)), tff: parseXgb(JSON.parse(rawTff)) }, metrics as Metrics)
}
