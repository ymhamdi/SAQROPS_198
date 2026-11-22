// Physics check of the fire engine against real fires: each UL FSRI experiment with a known heat release (measured by
// calorimetry, or the gas burner's set point) is replayed in OUR engine (app/src/fire/engine.ts) on the same room
// (3.7 × 3.7 × 2.4 m, 0.9 × 2.0 m door open or closed; walls assumed gypsum, the FSRI README does not say). The
// engine's hot-layer temperature is written next to the measured one (mean of the four thermocouples 0.3 m below the
// ceiling, OBSERVED). ml/fsri_physics_report.py turns it into RMSE and plots.
//
//   node ml/fsri_physics.ts   (reads ml/data/fsri_hrr.csv from ml/prepare_fsri.py, writes ml/data/fsri_physics.csv)

import { createWriteStream, readFileSync } from 'node:fs'
import { ignite, initFireState, stepFire, type FireSetup } from '../app/src/fire/engine.ts'
import { defaultFireParams } from '../app/src/fire/params.ts'

const W = 3.7
const H = 2.4
const DOOR = { widthM: 0.9, heightM: 2.0 }

interface Sample {
  t: number
  hrr: number
  ul: number
}
const runs = new Map<string, { source: string; door: string; s: Sample[] }>()
const lines = readFileSync('ml/data/fsri_hrr.csv', 'utf-8').trim().split(/\r?\n/).slice(1)
for (const line of lines) {
  const [run, t, hrr, ul, source, door] = line.split(',')
  let r = runs.get(run)
  if (!r) runs.set(run, (r = { source, door, s: [] }))
  r.s.push({ t: Number(t), hrr: Number(hrr), ul: Number(ul) })
}

const p = defaultFireParams()
const out = createWriteStream('ml/data/fsri_physics.csv')
out.write('run_id,t,door,hrr_source,hrr_kw,predicted_c,measured_c\n')
let n = 0
for (const [run, r] of runs) {
  if (r.source === 'none') continue // closed-door furniture: no heat release measured, nothing to replay
  const open = r.door === 'Open'
  const setup: FireSetup = {
    rooms: [
      {
        floorM2: W * W,
        heightM: H,
        surfaceM2: 2 * W * W + 4 * W * H - (open ? DOOR.widthM * DOOR.heightM : 0),
        walls: 'gypsum',
        flashoverModel: true,
        growth: 'medium',
        curve: { t: r.s.map((x) => x.t), q: r.s.map((x) => Math.max(0, x.hrr)) },
      },
    ],
    doors: open ? [{ rooms: [0, -1], widthM: DOOR.widthM, heightM: DOOR.heightM, at: { x: W / 2, y: 0 } }] : [],
    detectors: [],
  }
  const s = initFireState(setup, p, setup.doors.map(() => true), 1)
  ignite(s, 0, { x: W / 2, y: W / 2 })
  s.rooms[0].ignitedAt = 0
  for (const x of r.s) {
    if (x.t > 0) stepFire(setup, p, s, 1)
    out.write([run, x.t, r.door, r.source, x.hrr, s.rooms[0].layerC.toFixed(1), x.ul].join(',') + '\n')
  }
  n++
}
out.end()
console.log(`fsri_physics: ${n} experiments replayed → ml/data/fsri_physics.csv`)
