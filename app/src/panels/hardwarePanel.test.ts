// The « Télémétrie matérielle » panel: every value says where it comes from (R3), a replay is never « en direct », « Décision : COS »
// is on the reset (R2), and without hardware the PC is exactly the simulated PC it was.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { defaultSettings, initialTelemetry, type Telemetry } from '../hardware/ingest'
import { replayBanner, buildSampleReplay } from '../hardware/replay'
import type { HardwareControls } from '../hardware/useHardware'
import { loadPredictor } from '../ml/predict'
import type { SimControls } from '../sim/client'
import { applyAction } from '../sim/actions'
import { snapshot, type Snapshot } from '../sim/protocol'
import { initSim, makeContext } from '../sim/sim'
import { buildSite } from '../site/site'
import { HardwarePanel } from './HardwarePanel'
import { Pc } from './Pc'

const site = buildSite()
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const solvents = site.rooms.findIndex((r) => r.id === 'solvants')
let calm: Snapshot
let alarmed: Snapshot

beforeAll(() => {
  // Node has no ImageData, which the plan drawing creates while rendering the PC.
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
        if (typeof a === 'number') {
          this.width = a
          this.height = b
          this.data = new Uint8ClampedArray(a * b * 4)
        } else {
          this.data = a
          this.width = b
          this.height = c!
        }
      }
    },
  )
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  calm = structuredClone(snapshot(ctx, s))
  applyAction(ctx, s, { type: 'hardware', event: { kind: 'critical-room', room: solvents, roomName: 'stockage-solvants', valueC: 54.2, thresholdC: 35, status: 'OBSERVED' } })
  applyAction(ctx, s, { type: 'hardware', event: { kind: 'mayday', status: 'OBSERVED' } })
  alarmed = structuredClone(snapshot(ctx, s))
}, 60_000)
afterAll(() => vi.unstubAllGlobals())

const noop = () => {}
const telemetry = (over: Partial<Telemetry> = {}): Telemetry => ({
  drone: { room: 'stockage-solvants', roomIndex: solvents, tempC: 54.2, altM: 0.35, lastAtMs: 1000 },
  hud: { ariBar: 145, lastAtMs: 1000, mayday: false },
  origin: 'live',
  ...over,
})
const hw = (over: Partial<HardwareControls> = {}): HardwareControls => ({
  supported: true,
  status: { drone: { state: 'connected', lastPacketAtMs: 1000, error: null }, hud: { state: 'connected', lastPacketAtMs: 1000, error: null } },
  telemetry: telemetry(),
  settings: defaultSettings(),
  setSettings: noop,
  connect: async () => {},
  disconnect: async () => {},
  testHud: async () => {},
  lastHud: null,
  recording: false,
  recordedCount: 0,
  toggleRecording: noop,
  replayBanner: null,
  playBuiltIn: noop,
  playFile: async () => {},
  stopReplay: noop,
  message: null,
  nowMs: 1500,
  ...over,
})
const panel = (h: HardwareControls, snap: Snapshot = calm) => html(createElement(HardwarePanel, { site, snap, hw: h, onReengage: noop }))

describe('what the panel shows, and where each value comes from (R3)', () => {
  test('live: the raw reading is OBSERVED, the scaled one MODELED with its factor, the altitude and the pressure OBSERVED', () => {
    const out = panel(hw())
    expect(out).toContain('54.2')
    expect(out).toContain('542') // 54.2 × 10
    expect(out).toContain('badge-observed')
    expect(out).toContain('badge-modeled')
    expect(out).toContain('relevé × 10')
    expect(out).toContain('0.35')
    expect(out).toContain('145')
    expect(out).not.toContain('REJEU')
    expect(out).not.toContain('badge-replay')
  })

  test('the scaled value is labelled MODELED and never OBSERVED: the observed badge appears for the raw values only', () => {
    // temperature raw + altitude + pressure = 3 OBSERVED; the scaled temperature = 1 MODELED
    const out = panel(hw())
    expect((out.match(/badge-observed/g) ?? []).length).toBe(3)
    expect((out.match(/badge-modeled/g) ?? []).length).toBe(1)
  })

  test('the factor of the panel is the one shown and used', () => {
    const settings = { triggerThresholdC: 35, demoFactor: 4 }
    const out = panel(hw({ settings }))
    expect(out).toContain('relevé × 4')
    expect(out).toContain('217') // 54.2 × 4 = 216.8
  })

  test('replay: every value is REPLAY, with the banner, and nothing says « en direct »', () => {
    const banner = replayBanner(buildSampleReplay())
    const out = panel(hw({ telemetry: telemetry({ origin: 'replay' }), replayBanner: banner }))
    expect(out).toContain(banner)
    expect(out).toContain('badge-replay')
    expect(out).not.toContain('badge-observed')
    expect(out.toUpperCase()).not.toContain('EN DIRECT')
    expect(out).toContain('Arrêter le rejeu')
  })

  test('a recording of the live link says « REJEU d’une mesure réelle »', () => {
    const f = buildSampleReplay()
    const out = panel(hw({ replayBanner: replayBanner({ ...f, origin: 'web-serial-live' }), telemetry: telemetry({ origin: 'replay' }) }))
    expect(out).toContain('REJEU d’une mesure réelle')
  })

  test('before any packet, the numbers show a dash and still carry their label', () => {
    const out = panel(hw({ telemetry: initialTelemetry() }))
    expect(out).toContain('—')
    expect(out).toMatch(/badge-(observed|modeled)/)
  })
})

describe('the controls of the specification', () => {
  test('connect both devices, the threshold and the demo factor, the test button, record, replay', () => {
    const out = panel(hw({ status: { drone: { state: 'disconnected', lastPacketAtMs: null, error: null }, hud: { state: 'disconnected', lastPacketAtMs: null, error: null } } }))
    for (const text of ['Connecter le drone (ESP32)', 'Connecter le HUD binôme (STM32)', 'Seuil déclenchement (°C)', 'Facteur Mode Démo', 'Test NO-GO HUD', 'Enregistrer session', 'Rejouer démo', 'Charger un rejeu']) expect(out, text).toContain(text)
    expect(out).toContain('value="35"')
    expect(out).toContain('value="10"')
  })

  test('connected devices offer to disconnect; a recording in progress offers to stop and download', () => {
    const out = panel(hw({ recording: true, recordedCount: 12 }))
    expect(out).toContain('Déconnecter le drone (ESP32)')
    expect(out).toContain('Arrêter et télécharger (12)')
  })

  test('a browser without Web Serial says so, offers no connection, and keeps the replay', () => {
    const out = panel(hw({ supported: false, status: { drone: { state: 'disconnected', lastPacketAtMs: null, error: null }, hud: { state: 'disconnected', lastPacketAtMs: null, error: null } } }))
    expect(out).toContain('Chrome ou Edge')
    expect(out).toContain('Rejouer démo')
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Connecter/)
  })

  test('a device that stopped talking is shown as silent, its last value kept, never an all clear', () => {
    const out = panel(hw({ nowMs: 1000 + 10_000 }))
    expect(out).toContain('silencieux')
    expect(out).toContain('jamais lue comme « tout va bien »')
    expect(out).toContain('54.2')
  })

  test('an error is told in French', () => {
    expect(panel(hw({ message: 'Aucun port choisi (x)' }))).toContain('Aucun port choisi')
  })
})

describe('the dangers the hardware raised, and the COS’s decision (R2, R13)', () => {
  test('calm: nothing raised, the reset is not offered', () => {
    const out = panel(hw())
    expect(out).not.toContain('Chaleur anormale —')
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Ré-engager \(Décision : COS\)/)
  })

  test('a critical room and a mayday are listed with their reading and label, and the reset carries « Décision : COS »', () => {
    expect(alarmed.latched).toBe(true)
    const out = panel(hw(), alarmed)
    expect(out).toContain('Chaleur anormale — Stockage solvants')
    expect(out).toContain('54.2')
    expect(out).toContain('MAYDAY du chef de binôme')
    expect(out).toContain('Ré-engager (Décision : COS)')
    expect(out).not.toMatch(/<button[^>]*disabled[^>]*>Ré-engager/)
    expect(out).toContain('Le matériel ne peut qu’aggraver')
  })
})

describe('the PC', () => {
  const sim = (snap: Snapshot): SimControls => ({ snap, playing: false, speed: 10, error: null, setPlaying: noop, setSpeed: noop, act: noop, step: noop, reset: noop })
  const demo = { on: false, onToggle: noop, onRestart: noop, done: false, caption: '', text: '' }

  test('without hardware the PC has no hardware panel: it is the simulated PC it always was', () => {
    const out = html(createElement(Pc, { site, sim: sim(calm), onOpenCrew: noop, demo }))
    expect(out).not.toContain('Télémétrie matérielle')
    expect(out).toContain('Verdict de l')
  })

  test('with hardware the panel is there, and a replay banner tops the page', () => {
    const banner = replayBanner(buildSampleReplay())
    const out = html(createElement(Pc, { site, sim: sim(calm), onOpenCrew: noop, demo, hw: hw({ replayBanner: banner }) }))
    expect(out).toContain('Télémétrie matérielle')
    expect((out.match(new RegExp(banner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  test('the team’s pressure carries the cylinder’s label when it is the cylinder’s reading', () => {
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const s = initSim(ctx, initialDoors(site), 42)
    applyAction(ctx, s, { type: 'hardware', event: { kind: 'ari', bar: 150, status: 'REPLAY' } })
    const snap = structuredClone(snapshot(ctx, s))
    expect(snap.hardware.ariBinding).toBe(true)
    const out = html(createElement(Pc, { site, sim: sim(snap), onOpenCrew: noop, demo, hw: hw() }))
    expect(out).toContain('150')
    expect(out).toContain('badge-replay')
  })
})
