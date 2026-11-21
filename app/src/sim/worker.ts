// The simulation runs here, off the UI thread: fire engine, detectors, XGBoost (app/src/ml/xgb.ts), routes, verdict.

import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { buildSite } from '../site/site'
import { snapshot, type Action, type Request, type Response } from './protocol'
import { engage, evacuate, initSim, launchDrone, makeContext, reengageTeam, setObjectives, startFire, tick, toggleDoor, type SimState } from './sim'

const ctx = globalThis as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage(m: Response): void }

const site = buildSite()
const sim = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
let state: SimState = initSim(sim, initialDoors(site), 42)

function act(a: Action) {
  if (a.type === 'fire') startFire(sim, state, a.at)
  else if (a.type === 'door') toggleDoor(sim, state, a.door)
  else if (a.type === 'engage') engage(sim, state)
  else if (a.type === 'objectives') setObjectives(sim, state, a.ids, a.note)
  else if (a.type === 'evacuate') evacuate(sim, state)
  else if (a.type === 'reengage') reengageTeam(sim, state)
  else if (a.type === 'drone') launchDrone(sim, state)
}

ctx.onmessage = (e) => {
  const req = e.data
  try {
    if (req.type === 'reset') state = initSim(sim, initialDoors(site), req.seed)
    else if (req.type === 'step') for (let k = 0; k < req.n; k++) tick(sim, state)
    else act(req.action)
    ctx.postMessage({ id: req.id, ok: true, snapshot: snapshot(sim, state) })
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
