// Detector histories in long format → model rows, with the SAME TypeScript feature code as the app
// (app/src/ml/features.ts): the app and the training never see different inputs. Writes the schema of
// ml/data/scenarios.csv (run, room, t, 13 features, y30, y60, tff, censored), so ml/train.py takes either.
//
//   node ml/featurize.ts --long ml/data/x_long.csv --labels ml/data/x_labels.csv --meta ml/data/x_meta.json \
//        --out ml/data/x_features.csv [--every 10]
//
// long.csv   run_id,t,room,detector_id,temperature_C   sorted by run_id then t; one row per detector reading
// labels.csv run_id,room,flashover_s                    empty flashover_s = the room never flashed over
// meta.json  { "adjacency": { "<room>": ["<room>", ...] } } rooms sharing a door (the contract's neighbours)
//
// Failure exactly as in the simulator: a detector fails the first time it reads above config.json
// detectors.failureC and is NaN from then on. A missing reading before that (a logging gap) repeats the last value.

import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { H, v } from '../app/src/config.ts'
import { FEATURE_NAMES, featureVector, roomStats, trimHistory, type RoomHistory, type RoomStats } from '../app/src/ml/features.ts'
import contract from './model/contract.json' with { type: 'json' }

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const need = (k: string) => {
  const x = args.get(k)
  if (!x) throw new Error(`missing --${k}`)
  return x
}
const EVERY = Number(args.get('every') ?? 10)
const FAIL_C = v(H.detectors.failureC)
const CAP = contract.tffCapS

const meta = JSON.parse(readFileSync(need('meta'), 'utf-8')) as { adjacency: Record<string, string[]> }
const labels = new Map<string, number | null>()
for (const line of readFileSync(need('labels'), 'utf-8').trim().split(/\r?\n/).slice(1)) {
  const [run, room, fo] = line.split(',')
  labels.set(`${run}|${room}`, fo === '' || fo === undefined ? null : Number(fo))
}

const out = createWriteStream(need('out'))
out.write(['run', 'room', 't', ...FEATURE_NAMES, 'y30', 'y60', 'tff', 'censored'].join(',') + '\n')
const fmt = (x: number) => (Number.isNaN(x) ? '' : Number.isInteger(x) ? String(x) : x.toFixed(5))
let rows = 0
let runs = 0

interface Room {
  t: number[]
  dets: Map<string, number[]>
}

function flushRun(run: string, rooms: Map<string, Room>) {
  runs++
  const hist = new Map<string, RoomHistory>()
  for (const [name, r] of rooms) {
    const readings = [...r.dets.values()].map((series) => {
      const outS: number[] = []
      let failed = false
      let last = NaN
      for (const x of series) {
        if (failed) outS.push(NaN)
        else if (Number.isNaN(x)) outS.push(last)
        else if (x > FAIL_C) {
          failed = true
          outS.push(NaN)
        } else {
          last = x
          outS.push(x)
        }
      }
      return outS
    })
    hist.set(name, { t: r.t, readings })
  }
  const times = new Set<number>()
  for (const h of hist.values()) for (const t of h.t) if (t % EVERY === 0) times.add(t)
  for (const t of [...times].sort((a, b) => a - b)) {
    const stats = new Map<string, RoomStats>()
    for (const [name, h] of hist) stats.set(name, roomStats(trimHistory(h, t), t))
    for (const [name, s] of stats) {
      const fo = labels.get(`${run}|${name}`) ?? null
      if (fo !== null && fo <= t) continue // already flashed over: nothing left to predict
      const nb = (meta.adjacency[name] ?? []).filter((n) => stats.has(n)).map((n) => stats.get(n)!)
      const left = fo === null ? Infinity : fo - t
      out.write([run, name, t, ...featureVector(s, nb).map(fmt), left <= 30 ? 1 : 0, left <= 60 ? 1 : 0, fmt(Math.min(CAP, left)), fo === null || left > CAP ? 1 : 0].join(',') + '\n')
      rows++
    }
  }
}

const rl = createInterface({ input: createReadStream(need('long')), crlfDelay: Infinity })
let current: string | null = null
let rooms = new Map<string, Room>()
let header = true
for await (const line of rl) {
  if (header) {
    header = false
    continue
  }
  if (!line) continue
  const [run, ts, room, det, temp] = line.split(',')
  if (run !== current) {
    if (current !== null) flushRun(current, rooms)
    current = run
    rooms = new Map()
  }
  const t = Number(ts)
  let r = rooms.get(room)
  if (!r) rooms.set(room, (r = { t: [], dets: new Map() }))
  if (r.t[r.t.length - 1] !== t) {
    r.t.push(t)
    for (const s of r.dets.values()) s.push(NaN)
  }
  let s = r.dets.get(det)
  if (!s) {
    s = new Array<number>(r.t.length).fill(NaN)
    r.dets.set(det, s)
  }
  s[r.t.length - 1] = temp === '' ? NaN : Number(temp)
}
if (current !== null) flushRun(current, rooms)
out.end()
console.log(`featurize: ${runs} runs, ${rows} rows → ${args.get('out')}`)
