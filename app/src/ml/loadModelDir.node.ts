// Node only (tests): loads the three models and metrics.json of an exported model folder (ml/model-v1, ml/model-v4…)
// into a Predictor, the same way predict.ts loads the shipped one. Never imported by the app itself.

import { readFileSync } from 'node:fs'
import { makePredictor, type Predictor } from './predict'
import { parseXgb } from './xgb'

export function loadPredictorFrom(folder: 'model' | 'model-v1' | 'model-v4'): Predictor {
  const dir = new URL(`../../../ml/${folder}/`, import.meta.url)
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf-8'))
  return makePredictor({ p30: parseXgb(read('model-30s.json')), p60: parseXgb(read('model-60s.json')), tff: parseXgb(read('model-tff.json')) }, read('metrics.json'))
}
