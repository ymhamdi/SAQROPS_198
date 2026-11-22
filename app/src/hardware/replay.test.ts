// Recording and replaying a hardware session: deterministic timing, honest banners, and the built-in sequence takes the verdict
// to NO-GO through the real simulation exactly as the live hardware would.

import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { applyAction } from '../sim/actions'
import { engage, initSim, makeContext } from '../sim/sim'
import { buildSite } from '../site/site'
import { decide, defaultSettings } from './ingest'
import { parseLine, type HwMessage } from './protocol'
import { buildSampleReplay, parseReplayFile, Recorder, Replayer, replayBanner, type ReplayFile, type Timers } from './replay'

const site = buildSite()
const msg = (sensor: HwMessage['sensor'], value: number, room = 'atelier'): HwMessage => ({ seq: 1, tMs: 5, source: 'drone-payload', sensor, value, unit: 'C', room })

/** A clock the test moves by hand, with timers that fire when it reaches them. */
function fakeTimers() {
  let now = 0
  let next = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++
      pending.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => void pending.delete(id as number),
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      pending.delete(due[0])
      now = Math.max(now, due[1].at)
      due[1].fn()
    }
    now = end
  }
  return { timers, advance, pending: () => pending.size }
}

describe('Recorder', () => {
  test('records the packets with their time since the first, and gives back a pnr-replay file', () => {
    const r = new Recorder()
    r.start()
    r.add('drone', msg('temp_bmp280', 24), 5000)
    r.add('drone', msg('temp_bmp280', 25), 5500)
    r.add('hud', msg('ari_bar', 200), 5700)
    const f = r.stop('2026-11-21T23:00:00Z')
    expect(f).toMatchObject({ format: 'pnr-replay', version: 1, origin: 'web-serial-live', recordedAt: '2026-11-21T23:00:00Z' })
    expect(f.entries.map((e) => [e.delta_ms, e.role])).toEqual([[0, 'drone'], [500, 'drone'], [700, 'hud']])
    expect(f.entries[0].raw).toMatchObject({ sensor: 'temp_bmp280', value: 24, t_ms: 5 })
  })

  test('records nothing before start or after stop', () => {
    const r = new Recorder()
    r.add('drone', msg('temp_bmp280', 24), 1)
    expect(r.count).toBe(0)
    r.start()
    r.add('drone', msg('temp_bmp280', 24), 1)
    r.stop('x')
    r.add('drone', msg('temp_bmp280', 30), 2)
    expect(r.count).toBe(1)
    expect(r.active).toBe(false)
  })

  test('what it records survives a round trip through the file', () => {
    const r = new Recorder()
    r.start()
    r.add('drone', msg('temp_bmp280', 48.2), 10)
    r.add('hud', { ...msg('mayday', 1), unit: 'bool', room: 'binome-1' }, 20)
    const back = parseReplayFile(JSON.stringify(r.stop('t')))
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.file.origin).toBe('web-serial-live')
    expect(back.file.entries.map((e) => parseLine(JSON.stringify(e.raw))?.value)).toEqual([48.2, 1])
  })
})

describe('parseReplayFile: any file the user picks', () => {
  test('not JSON, not a replay, no valid packet: an error in French, never a throw', () => {
    for (const t of ['', 'hello', '{}', '[]', '{"format":"pnr-replay","entries":"x"}', '{"format":"pnr-replay","version":1,"entries":[{"delta_ms":0,"role":"drone","raw":{"sensor":"gps","value":1}}]}']) {
      const r = parseReplayFile(t)
      expect(r.ok, t).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10)
    }
  })

  test('invalid packets are dropped, the valid ones kept in time order', () => {
    const file = {
      format: 'pnr-replay',
      version: 1,
      origin: 'web-serial-live',
      entries: [
        { delta_ms: 500, role: 'drone', raw: { sensor: 'temp_bmp280', value: 30 } },
        { delta_ms: -5, role: 'drone', raw: { sensor: 'temp_bmp280', value: 1 } },
        { delta_ms: 100, role: 'drone', raw: { sensor: 'temp_bmp280', value: 20 } },
        { delta_ms: 200, role: 'gps', raw: { sensor: 'temp_bmp280', value: 1 } },
        { delta_ms: 300, role: 'hud', raw: { sensor: 'ari_bar', value: 'x' } },
      ],
    }
    const r = parseReplayFile(JSON.stringify(file))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.entries.map((e) => e.delta_ms)).toEqual([100, 500])
  })

  test('only a file that says the app recorded it live can claim to be a real measurement', () => {
    const body = (origin?: string) => JSON.stringify({ format: 'pnr-replay', version: 1, ...(origin ? { origin } : {}), entries: [{ delta_ms: 0, role: 'drone', raw: { sensor: 'temp_bmp280', value: 20 } }] })
    const get = (o?: string) => {
      const r = parseReplayFile(body(o))
      if (!r.ok) throw new Error('should parse')
      return r.file.origin
    }
    expect(get('web-serial-live')).toBe('web-serial-live')
    expect(get('built-in-sample')).toBe('built-in-sample')
    expect(get()).toBe('unverified')
    expect(get('something else')).toBe('unverified')
  })
})

describe('the banner of a replay', () => {
  const file = (origin: ReplayFile['origin']): ReplayFile => ({ format: 'pnr-replay', version: 1, origin, recordedAt: null, entries: [] })

  test('a recording of the live link says « REJEU d’une mesure réelle »', () => {
    expect(replayBanner(file('web-serial-live'))).toBe('REJEU d’une mesure réelle')
  })

  test('the hand-written sequence and an unverified file never claim to be a measurement', () => {
    for (const o of ['built-in-sample', 'unverified'] as const) {
      const b = replayBanner(file(o))
      expect(b).toMatch(/^REJEU/)
      expect(b).toMatch(/pas une mesure/)
      expect(b).not.toMatch(/mesure réelle/)
    }
  })

  test('no banner ever says « EN DIRECT »', () => {
    for (const o of ['web-serial-live', 'built-in-sample', 'unverified'] as const) expect(replayBanner(file(o)).toUpperCase()).not.toContain('EN DIRECT')
  })
})

describe('the built-in sequence', () => {
  const f = buildSampleReplay()
  const temps = f.entries.filter((e) => e.raw.sensor === 'temp_bmp280')
  const aris = f.entries.filter((e) => e.raw.sensor === 'ari_bar')

  test('is labelled as the built-in sample, and every packet is valid', () => {
    expect(f.origin).toBe('built-in-sample')
    for (const e of f.entries) expect(parseLine(JSON.stringify(e.raw))).not.toBeNull()
  })

  test('the drone enters the entry airlock, then the workshop, then the solvent store, cool, then the store heats up to the peak', () => {
    const rooms = temps.map((e) => e.raw.room)
    expect(rooms[0]).toBe('sas-entree')
    expect([...new Set(rooms)]).toEqual(['sas-entree', 'atelier', 'stockage-solvants'])
    const cool = v(H.hardware.sampleCoolC)
    const peak = v(H.hardware.samplePeakC)
    const dwell = v(H.hardware.sampleRoomDwellS) * 1000
    for (const e of temps.filter((x) => x.delta_ms <= 3 * dwell)) expect(e.raw.value).toBe(cool)
    expect(temps.at(-1)!.raw.value).toBe(peak)
    const values = temps.map((e) => e.raw.value as number)
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
  })

  test('the packets come at the cadence of the firmware: every 500 ms for the drone, every 400 ms for the HUD', () => {
    const gaps = (xs: typeof temps) => [...new Set(xs.slice(1).map((e, i) => e.delta_ms - xs[i].delta_ms))]
    expect(gaps(temps)).toEqual([v(H.hardware.droneIntervalMs)])
    expect(gaps(aris)).toEqual([v(H.hardware.hudIntervalMs)])
    // The drone sends two lines per cycle, temperature and altitude, at the same time.
    expect(f.entries.filter((e) => e.raw.sensor === 'alt_bmp280')).toHaveLength(temps.length)
  })

  test('the cylinder goes from 220 to 110 bar, never up', () => {
    const bars = aris.map((e) => e.raw.value as number)
    expect(bars[0]).toBe(v(H.hardware.sampleAriStartBar))
    expect(bars.at(-1)).toBe(v(H.hardware.sampleAriEndBar))
    for (let i = 1; i < bars.length; i++) expect(bars[i]).toBeLessThanOrEqual(bars[i - 1])
  })

  test('through the real simulation it takes the verdict to NO-GO when the store crosses the threshold, and the air at the end', () => {
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const s = initSim(ctx, initialDoors(site), 42)
    engage(ctx, s)
    const settings = defaultSettings()
    let firstNoGoAtMs: number | null = null
    let beforeThreshold = true
    for (const e of f.entries) {
      const m = parseLine(JSON.stringify(e.raw))!
      const ev = decide(m, 'replay', settings, site)
      if (ev) applyAction(ctx, s, { type: 'hardware', event: ev })
      if (m.sensor === 'temp_bmp280' && m.value < settings.triggerThresholdC) beforeThreshold = beforeThreshold && s.shown.verdict === 'GO'
      if (firstNoGoAtMs === null && s.shown.verdict === 'NO-GO') firstNoGoAtMs = e.delta_ms
    }
    // GO while the store reads below the threshold and the air is fine; NO-GO once it crosses 35 °C.
    expect(beforeThreshold).toBe(true)
    expect(firstNoGoAtMs).not.toBeNull()
    const cool = v(H.hardware.sampleCoolC)
    const peak = v(H.hardware.samplePeakC)
    const crossAt = 3 * v(H.hardware.sampleRoomDwellS) * 1000 + (v(H.hardware.sampleHeatS) * 1000 * (settings.triggerThresholdC - cool)) / (peak - cool)
    expect(firstNoGoAtMs!).toBeLessThanOrEqual(crossAt + v(H.hardware.droneIntervalMs))
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.shown.reasons.some((r) => r.code === 'HARDWARE_HOT' && r.status === 'REPLAY')).toBe(true)
  }, 60_000)
})

describe('Replayer: deterministic timing', () => {
  const small = (): ReplayFile => ({
    format: 'pnr-replay',
    version: 1,
    origin: 'web-serial-live',
    recordedAt: null,
    entries: [
      { delta_ms: 0, role: 'drone', raw: { sensor: 'temp_bmp280', value: 1 } },
      { delta_ms: 0, role: 'drone', raw: { sensor: 'alt_bmp280', value: 2 } },
      { delta_ms: 500, role: 'drone', raw: { sensor: 'temp_bmp280', value: 3 } },
      { delta_ms: 900, role: 'hud', raw: { sensor: 'ari_bar', value: 4 } },
    ],
  })

  test('plays each packet at its time, in order, and ends once', () => {
    const t = fakeTimers()
    const got: [number, number][] = []
    let ended = 0
    const clock = t.timers.now
    const r = new Replayer({ timers: t.timers, onMessage: (_role, m) => got.push([clock(), m.value]), onEnd: () => ended++ })
    r.start(small())
    expect(r.running).toBe(true)
    t.advance(0)
    expect(got).toEqual([[0, 1], [0, 2]])
    t.advance(499)
    expect(got).toHaveLength(2)
    t.advance(1)
    expect(got.at(-1)).toEqual([500, 3])
    t.advance(1000)
    expect(got.map((g) => g[1])).toEqual([1, 2, 3, 4])
    expect(got.at(-1)![0]).toBe(900)
    expect(ended).toBe(1)
    expect(r.running).toBe(false)
  })

  test('stop cancels what is left and never calls the end', () => {
    const t = fakeTimers()
    const got: number[] = []
    let ended = 0
    const r = new Replayer({ timers: t.timers, onMessage: (_r, m) => got.push(m.value), onEnd: () => ended++ })
    r.start(small())
    t.advance(100)
    r.stop()
    t.advance(5000)
    expect(got).toEqual([1, 2])
    expect(ended).toBe(0)
    expect(t.pending()).toBe(0)
  })

  test('starting again restarts from the beginning, and only one timer is ever pending', () => {
    const t = fakeTimers()
    const got: number[] = []
    const r = new Replayer({ timers: t.timers, onMessage: (_r, m) => got.push(m.value), onEnd: () => {} })
    r.start(small())
    t.advance(600)
    r.start(small())
    expect(t.pending()).toBe(1)
    t.advance(0)
    expect(got.slice(-2)).toEqual([1, 2])
  })

  test('the built-in sequence plays in real time: it takes as long as it says', () => {
    const t = fakeTimers()
    const f = buildSampleReplay()
    let n = 0
    let ended = false
    const r = new Replayer({ timers: t.timers, onMessage: () => n++, onEnd: () => (ended = true) })
    r.start(f)
    const total = f.entries.at(-1)!.delta_ms
    t.advance(total - 1)
    expect(ended).toBe(false)
    t.advance(2)
    expect(ended).toBe(true)
    expect(n).toBe(f.entries.length)
  })
})
