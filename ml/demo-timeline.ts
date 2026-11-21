// Prints the demo scenario's timeline (dev check). node ml/demo-timeline.ts
import { buildSite } from '../app/src/site/site.ts'
import { fireSetupOf, initialDoors } from '../app/src/fire/siteSetup.ts'
import { defaultFireParams } from '../app/src/fire/params.ts'
import { ignite, initFireState, stepFire } from '../app/src/fire/engine.ts'

const site = buildSite()
const setup = fireSetupOf(site)
const p = defaultFireParams()
const s = initFireState(setup, p, initialDoors(site), 42)
ignite(s, site.demo.fireRoom, site.demo.fireAt)
const ids = site.rooms.map((r) => r.id)
const watch = ['solvants', 'peinture', 'halle'].map((id) => ids.indexOf(id))
const detIdx = site.detectors.map((d, i) => [d.id, i] as const).filter(([id]) => /solvants|peinture|halle-1/.test(id))
let lastFailed = new Set<string>()
for (let k = 0; k < 900; k++) {
  stepFire(setup, p, s, 1)
  for (const [id, i] of detIdx) if (s.detectors[i].failed && !lastFailed.has(id)) { console.log(`t=${s.t}s detector ${id} FAILED`); lastFailed.add(id) }
  for (const i of watch) { const r = s.rooms[i]; if (r.flashedAt === s.t) console.log(`t=${s.t}s FLASHOVER ${ids[i]}`); if (r.ignitedAt === s.t && s.t > 1) console.log(`t=${s.t}s IGNITION ${ids[i]}`) }
  if (s.t % 30 === 0) console.log(`t=${String(s.t).padStart(3)} ` + watch.map((i) => { const r = s.rooms[i]; return `${ids[i]}: Q=${r.qKw.toFixed(0)}kW T=${r.layerC.toFixed(0)}C z=${r.layerZ.toFixed(2)}m` }).join(' | ') + ' | det ' + detIdx.map(([id, i]) => `${id.replace('det-','')}=${Number.isNaN(s.detectors[i].reading) ? 'X' : s.detectors[i].reading.toFixed(0)}`).join(' '))
}
