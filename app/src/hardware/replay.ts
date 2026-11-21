// Recording a hardware session, and playing it back deterministically when the USB link fails on the day (or to rehearse).
//
// A recording is a list of packets with `delta_ms` (milliseconds since the start of the recording), saved as pnr-replay.json.
// Everything it plays is labelled REPLAY, with a banner that says it is a replay and never « en direct ». The banner names
// what the recording is, honestly:
//   - a file the app recorded from the live USB link: « REJEU d'une mesure réelle »
//   - the built-in sequence, written by hand for the demo: it says so, because it is NOT a measurement.

import { H, v } from '../config'
import { parseLine, type HwMessage } from './protocol'
import type { Role } from './serialManager'

export type ReplayOrigin = 'web-serial-live' | 'built-in-sample' | 'unverified'

export interface ReplayEntry {
  /** milliseconds since the start of the recording */
  delta_ms: number
  role: Role
  /** the packet as the device sent it */
  raw: Record<string, unknown>
}

export interface ReplayFile {
  format: 'pnr-replay'
  version: 1
  /** where the packets came from: only the app, recording the live link, writes 'web-serial-live' */
  origin: ReplayOrigin
  recordedAt: string | null
  entries: ReplayEntry[]
}

const toRaw = (m: HwMessage): Record<string, unknown> => ({ seq: m.seq, t_ms: m.tMs, source: m.source, sensor: m.sensor, value: m.value, unit: m.unit, room: m.room })

/** Records the packets that arrive from the live link, with their time since the first. Never records a replay. */
export class Recorder {
  private startMs: number | null = null
  private entries: ReplayEntry[] = []
  private on = false

  get active(): boolean {
    return this.on
  }
  get count(): number {
    return this.entries.length
  }

  start(): void {
    this.on = true
    this.startMs = null
    this.entries = []
  }

  add(role: Role, msg: HwMessage, nowMs: number): void {
    if (!this.on) return
    this.startMs ??= nowMs
    this.entries.push({ delta_ms: Math.max(0, Math.round(nowMs - this.startMs)), role, raw: toRaw(msg) })
  }

  stop(recordedAt: string): ReplayFile {
    this.on = false
    return { format: 'pnr-replay', version: 1, origin: 'web-serial-live', recordedAt, entries: this.entries }
  }
}

export type ParsedReplay = { ok: true; file: ReplayFile } | { ok: false; error: string }

/** A file chosen by the user: checked packet by packet, in time order. Anything wrong is an error message, never a crash. */
export function parseReplayFile(text: string): ParsedReplay {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Ce fichier n’est pas du JSON.' }
  }
  const o = raw as Partial<ReplayFile> | null
  if (!o || typeof o !== 'object' || o.format !== 'pnr-replay' || !Array.isArray(o.entries)) return { ok: false, error: 'Ce n’est pas un fichier de rejeu PNR (format « pnr-replay » attendu).' }
  const entries: ReplayEntry[] = []
  for (const e of o.entries as unknown[]) {
    const x = e as Partial<ReplayEntry>
    if (!x || typeof x.delta_ms !== 'number' || !Number.isFinite(x.delta_ms) || x.delta_ms < 0 || (x.role !== 'drone' && x.role !== 'hud') || typeof x.raw !== 'object' || x.raw === null) continue
    // A packet the protocol would reject is dropped, as it would be live.
    if (!parseLine(JSON.stringify(x.raw))) continue
    entries.push({ delta_ms: x.delta_ms, role: x.role, raw: x.raw })
  }
  if (entries.length === 0) return { ok: false, error: 'Ce fichier ne contient aucun paquet valide.' }
  entries.sort((a, b) => a.delta_ms - b.delta_ms)
  // Only a file that says the app recorded it from the live link is presented as a real measurement; a file with any other
  // (or no) origin is « non vérifiée », whatever it contains.
  const origin: ReplayOrigin = o.origin === 'web-serial-live' ? 'web-serial-live' : o.origin === 'built-in-sample' ? 'built-in-sample' : 'unverified'
  return { ok: true, file: { format: 'pnr-replay', version: 1, origin, recordedAt: typeof o.recordedAt === 'string' ? o.recordedAt : null, entries } }
}

/** The banner shown for the whole replay: always « REJEU », never « EN DIRECT », and honest about what is replayed. */
export function replayBanner(file: ReplayFile): string {
  if (file.origin === 'web-serial-live') return 'REJEU d’une mesure réelle'
  if (file.origin === 'built-in-sample') return 'REJEU d’une séquence de démonstration intégrée — valeurs écrites à la main, pas une mesure'
  return 'REJEU d’un fichier d’origine non vérifiée — pas une mesure'
}

/**
 * The built-in sequence: the drone enters the entry airlock, the workshop, then the solvent store, reading the cool value,
 * then the store heats up to the peak while the cylinder goes down. Written by hand from the configuration, NOT a measurement.
 */
export function buildSampleReplay(): ReplayFile {
  const cool = v(H.hardware.sampleCoolC)
  const peak = v(H.hardware.samplePeakC)
  const dwell = v(H.hardware.sampleRoomDwellS) * 1000
  const heat = v(H.hardware.sampleHeatS) * 1000
  const total = 3 * dwell + heat
  const a0 = v(H.hardware.sampleAriStartBar)
  const a1 = v(H.hardware.sampleAriEndBar)
  const rooms = ['sas-entree', 'atelier', 'stockage-solvants'] as const
  const entries: ReplayEntry[] = []
  let seq = 0
  const round = (x: number) => Math.round(x * 10) / 10
  for (let t = 0; t <= total; t += v(H.hardware.droneIntervalMs)) {
    const room = rooms[Math.min(2, Math.floor(t / dwell))]
    const tempC = t <= 3 * dwell ? cool : cool + ((peak - cool) * (t - 3 * dwell)) / heat
    const base = { t_ms: t, source: 'drone-payload', room }
    entries.push({ delta_ms: t, role: 'drone', raw: { seq: seq++, ...base, sensor: 'temp_bmp280', value: round(tempC), unit: 'C' } })
    entries.push({ delta_ms: t, role: 'drone', raw: { seq: seq++, ...base, sensor: 'alt_bmp280', value: 0.35, unit: 'm' } })
  }
  for (let t = 0; t <= total; t += v(H.hardware.hudIntervalMs)) {
    entries.push({
      delta_ms: t,
      role: 'hud',
      raw: { seq: seq++, t_ms: t, source: 'binome-hud', sensor: 'ari_bar', value: round(a0 + ((a1 - a0) * t) / total), unit: 'bar', room: 'binome-1' },
    })
  }
  entries.sort((a, b) => a.delta_ms - b.delta_ms)
  return { format: 'pnr-replay', version: 1, origin: 'built-in-sample', recordedAt: null, entries }
}

export interface Timers {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

export const realTimers = (): Timers => ({ now: () => Date.now(), setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id as number) })

/** Plays a recording at its own timing, one timer at a time (never thousands). */
export class Replayer {
  private timer: unknown = null
  private index = 0
  private startedAt = 0
  private file: ReplayFile | null = null
  private readonly timers: Timers
  private readonly onMessage: (role: Role, msg: HwMessage) => void
  private readonly onEnd: () => void

  constructor(opts: { timers?: Timers; onMessage: (role: Role, msg: HwMessage) => void; onEnd: () => void }) {
    this.timers = opts.timers ?? realTimers()
    this.onMessage = opts.onMessage
    this.onEnd = opts.onEnd
  }

  get running(): boolean {
    return this.file !== null
  }

  start(file: ReplayFile): void {
    this.stop()
    this.file = file
    this.index = 0
    this.startedAt = this.timers.now()
    this.schedule()
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    this.file = null
  }

  private schedule(): void {
    const file = this.file
    if (!file) return
    if (this.index >= file.entries.length) {
      this.file = null
      this.timer = null
      this.onEnd()
      return
    }
    const due = this.startedAt + file.entries[this.index].delta_ms
    this.timer = this.timers.setTimeout(() => this.fire(), Math.max(0, due - this.timers.now()))
  }

  private fire(): void {
    const file = this.file
    if (!file) return
    // Everything due by now goes out together, in order (several packets share a time).
    const now = this.timers.now()
    while (this.index < file.entries.length && this.startedAt + file.entries[this.index].delta_ms <= now) {
      const e = file.entries[this.index++]
      const msg = parseLine(JSON.stringify(e.raw))
      if (msg) this.onMessage(e.role, msg)
      if (!this.file) return
    }
    this.schedule()
  }
}
