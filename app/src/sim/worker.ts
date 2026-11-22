// The simulation runs here, off the UI thread: fire engine, detectors, XGBoost (app/src/ml/xgb.ts), routes, verdict.

import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { buildSite } from '../site/site'
import { applyAction } from './actions'
import { snapshot, type Request, type Response } from './protocol'
import { initSim, makeContext, tick, type SimState } from './sim'

const ctx = globalThis as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage(m: Response): void }

const site = buildSite()
const predictor = loadPredictor()
const sim = makeContext(site, fireSetupOf(site), defaultFireParams(), predictor)
let state: SimState = initSim(sim, initialDoors(site), 42)

ctx.onmessage = (e) => {
  const req = e.data
  try {
    if (req.type === 'reset') state = initSim(sim, initialDoors(site), req.seed)
    else if (req.type === 'step') for (let k = 0; k < req.n; k++) tick(sim, state)
    else applyAction(sim, state, req.action)
    ctx.postMessage({ id: req.id, ok: true, snapshot: snapshot(sim, state) })
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
