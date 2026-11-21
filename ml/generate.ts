// Plan B dataset (CLAUDE.md §11): random compartments run through the SAME fire engine as the app, features from the
// SAME code (app/src/ml/features.ts), written in the same CSV schema as ml/prepare.py writes from NIST P-Flash.
// Status: SIMULATED by our engine (MODELED correlations). Run: node ml/generate.ts --n 5000 --seed 42 --out ml/data/scenarios.csv

import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ignite, initFireState, setDoor, stepFire, type FireSetup, type RoomGeom } from '../app/src/fire/engine.ts'
import { defaultFireParams, type GrowthName } from '../app/src/fire/params.ts'
import { FEATURE_NAMES, featureVector, roomStats, type RoomHistory } from '../app/src/ml/features.ts'
import contract from './model/contract.json' with { type: 'json' }

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const N = Number(args.get('n') ?? 5000)
const SEED = Number(args.get('seed') ?? 42)
const OUT = args.get('out') ?? 'ml/data/scenarios.csv'
const SAMPLE_EVERY_S = Number(args.get('every') ?? 10)
const DURATION_S = Number(args.get('duration') ?? 720)

let seed = SEED
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (a: number, b: number) => a + rand() * (b - a)
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]

const GROWTHS: GrowthName[] = ['slow', 'medium', 'medium', 'fast', 'fast', 'ultraFast']

/** A chain of 2-4 room-sized compartments, one of them open to the outside. */
function randomSetup(): FireSetup {
  const n = 2 + Math.floor(rand() * 3)
  const rooms: RoomGeom[] = []
  for (let i = 0; i < n; i++) {
    const w = between(3, 8)
    const d = between(3, 10)
    const h = between(2.4, 4.5)
    rooms.push({ floorM2: w * d, heightM: h, surfaceM2: 2 * w * d + 2 * (w + d) * h, walls: rand() < 0.65 ? 'gypsum' : 'concrete', flashoverModel: true, growth: pick(GROWTHS) })
  }
  const doors: FireSetup['doors'] = []
  for (let i = 0; i + 1 < n; i++) doors.push({ rooms: [i, i + 1], widthM: between(0.8, 2.0), heightM: between(2.0, 2.4), at: { x: 10 * (i + 1), y: 2 } })
  doors.push({ rooms: [Math.floor(rand() * n), -1], widthM: between(0.8, 1.6), heightM: 2.1, at: { x: 0, y: 2 } })
  const detectors: FireSetup['detectors'] = []
  rooms.forEach((_, i) => {
    const k = 1 + Math.floor(rand() * 2)
    for (let j = 0; j < k; j++) detectors.push({ room: i, at: { x: 10 * i + between(0.5, 4), y: between(0.5, 4) } })
  })
  return { rooms, doors, detectors }
}

mkdirSync(dirname(OUT), { recursive: true })
const out = createWriteStream(OUT)
out.write(['run', 'room', 't', ...FEATURE_NAMES, 'y30', 'y60', 'tff', 'censored'].join(',') + '\n')
const p = defaultFireParams()
const cap = contract.tffCapS
const fmt = (x: number) => (Number.isNaN(x) ? '' : Number.isInteger(x) ? String(x) : x.toFixed(5))
let rows = 0
let flashedRooms = 0
const t0 = Date.now()

for (let run = 0; run < N; run++) {
  const setup = randomSetup()
  const doorsOpen = setup.doors.map((d) => d.rooms[1] === -1 || rand() < 0.7)
  const s = initFireState(setup, p, doorsOpen, SEED * 100003 + run)
  const fireRoom = Math.floor(rand() * setup.rooms.length)
  const igniteAt = Math.floor(between(0, 90))
  // One door may change state during the run (P-Flash v2 also varies door openings).
  const toggle = rand() < 0.3 ? { door: Math.floor(rand() * setup.doors.length), at: Math.floor(between(60, 400)) } : null
  const hist: RoomHistory[] = setup.rooms.map((_, r) => ({ t: [], readings: setup.detectors.filter((d) => d.room === r).map(() => []) }))
  const detsOf = setup.rooms.map((_, r) => setup.detectors.flatMap((d, i) => (d.room === r ? [i] : [])))
  const samples: { t: number; room: number; row: number[] }[] = []
  for (let k = 0; k < DURATION_S; k++) {
    if (k === igniteAt) ignite(s, fireRoom, { x: 10 * fireRoom + between(0.5, 3), y: between(0.5, 3) })
    if (toggle && k === toggle.at) setDoor(s, toggle.door, !s.doorOpen[toggle.door])
    stepFire(setup, p, s, 1)
    detsOf.forEach((dets, r) => {
      hist[r].t.push(s.t)
      dets.forEach((d, j) => hist[r].readings[j].push(s.detectors[d].reading))
    })
    if (s.t % SAMPLE_EVERY_S !== 0) continue
    const stats = hist.map((h) => roomStats(h, s.t))
    setup.rooms.forEach((_, r) => {
      if (s.rooms[r].flashedAt !== null) return // already flashed over: nothing left to predict
      const nb = setup.doors.flatMap((d) => (d.rooms[0] === r && d.rooms[1] >= 0 ? [d.rooms[1]] : d.rooms[1] === r && d.rooms[0] >= 0 ? [d.rooms[0]] : []))
      samples.push({ t: s.t, room: r, row: featureVector(stats[r], nb.map((x) => stats[x])) })
    })
  }
  for (const smp of samples) {
    const fo = s.rooms[smp.room].flashedAt
    const left = fo === null ? Infinity : fo - smp.t
    const tff = Math.min(cap, left)
    // Keep every sample near a flashover; thin out the long quiet stretches.
    if (left > 120 && rand() > 0.35) continue
    out.write([run, smp.room, smp.t, ...smp.row.map(fmt), left <= 30 ? 1 : 0, left <= 60 ? 1 : 0, fmt(tff), fo === null || left > cap ? 1 : 0].join(',') + '\n')
    rows++
  }
  flashedRooms += s.rooms.filter((r) => r.flashedAt !== null).length
  if ((run + 1) % 500 === 0) console.log(`${run + 1}/${N} runs, ${rows} rows, ${flashedRooms} flashovers, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
out.end()
console.log(`done: ${N} runs, ${rows} rows, ${flashedRooms} rooms flashed over → ${OUT}`)
