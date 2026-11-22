// The whole chain the PC runs, without a browser: bytes on two fake USB ports → the Web Serial manager → what a packet may do →
// the simulation's verdict → the order written back to the HUD. The React hook is thin glue around exactly these parts.

import { describe, expect, test, vi } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { applyAction } from '../sim/actions'
import { initSim, makeContext, engage, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { EventGate } from './gate'
import { decide, defaultSettings, type HardwareEvent } from './ingest'
import { SerialManager, type SerialApi, type SerialPortLike } from './serialManager'

vi.setConfig({ testTimeout: 120_000 })

const site = buildSite()
const enc = new TextEncoder()
const wait = () => new Promise((r) => setTimeout(r, 0))

class Port implements SerialPortLike {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  written: string[] = []
  private c!: ReadableStreamDefaultController<Uint8Array>
  constructor() {
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => (this.c = c) })
    this.writable = new WritableStream<Uint8Array>({ write: (b) => void this.written.push(new TextDecoder().decode(b)) })
  }
  async open() {}
  async close() {}
  send(text: string) {
    this.c.enqueue(enc.encode(text))
  }
}

const drone = (n: number, c: number, room = 'stockage-solvants') => `{"seq":${n},"t_ms":${n * 500},"source":"drone-payload","sensor":"temp_bmp280","value":${c},"unit":"C","room":"${room}"}\n`
const ari = (n: number, bar: number) => `{"seq":${n},"t_ms":${n * 400},"source":"binome-hud","sensor":"ari_bar","value":${bar},"unit":"bar","room":"binome-1"}\n`
const mayday = (n: number) => `{"seq":${n},"t_ms":${n * 400},"source":"binome-hud","sensor":"mayday","value":1,"unit":"bool","room":"binome-1"}\n`

async function rig() {
  const dronePort = new Port()
  const hudPort = new Port()
  const queue = [dronePort, hudPort]
  const api: SerialApi = { requestPort: async () => queue.shift()! }
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  const gate = new EventGate()
  const settings = defaultSettings()
  let lastVerdict = s.shown.verdict
  const events: HardwareEvent[] = []

  const pushVerdict = () => {
    if (s.shown.verdict !== lastVerdict) {
      lastVerdict = s.shown.verdict
      void m.sendHudAlert(lastVerdict)
    }
  }
  const m: SerialManager = new SerialManager({
    api,
    baudRate: 115200,
    now: () => Date.now(),
    onChange: () => {},
    onMessage: (_role, msg) => {
      const ev = decide(msg, 'live', settings, site)
      if (ev && gate.pass(ev)) {
        events.push(ev)
        applyAction(ctx, s, { type: 'hardware', event: ev })
        pushVerdict()
      }
    },
  })
  await m.connect('drone')
  await m.connect('hud')
  return { ctx, s, m, dronePort, hudPort, gate, events, pushVerdict }
}

describe('the live chain: USB → verdict → HUD', () => {
  test('a room that heats up: nothing while it is cool, NO-GO and the order to the HUD the moment it crosses the threshold', async () => {
    const { s, dronePort, hudPort, events } = await rig()
    dronePort.send(drone(1, 24) + drone(2, 26) + drone(3, 30) + drone(4, 34.9))
    await wait()
    await wait()
    expect(s.shown.verdict).toBe('GO')
    expect(events).toEqual([])
    expect(hudPort.written).toEqual([])
    dronePort.send(drone(5, 36.4))
    await wait()
    await wait()
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.shown.reasons.find((r) => r.code === 'HARDWARE_HOT')!.message).toBe('Chaleur anormale relevée par la charge utile — Stockage solvants')
    expect(hudPort.written).toEqual(['{"cmd":"alert","level":"NO-GO"}\n'])
  })

  test('the room cools down and the packets go on: still NO-GO, and the HUD is not told GO', async () => {
    const { s, dronePort, hudPort } = await rig()
    dronePort.send(drone(1, 48) + drone(2, 41) + drone(3, 30) + drone(4, 22) + drone(5, 19))
    await wait()
    await wait()
    expect(s.shown.verdict).toBe('NO-GO')
    expect(hudPort.written).toEqual(['{"cmd":"alert","level":"NO-GO"}\n'])
  })

  test('the drone goes silent after the danger: still NO-GO a long time later', async () => {
    const { ctx, s, dronePort } = await rig()
    dronePort.send(drone(1, 48))
    await wait()
    await wait()
    for (let k = 0; k < 120; k++) tick(ctx, s)
    expect(s.shown.verdict).toBe('NO-GO')
  })

  test('a stream of identical hot packets is one event, not one per packet', async () => {
    const { dronePort, events } = await rig()
    for (let n = 1; n <= 30; n++) dronePort.send(drone(n, 48))
    await wait()
    await wait()
    expect(events).toHaveLength(1)
  })

  test('the mayday from the HUD recalls an engaged team and the order goes back to the HUD', async () => {
    const { ctx, s, hudPort } = await rig()
    engage(ctx, s)
    hudPort.send(mayday(1))
    await wait()
    await wait()
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.team.mode).toBe('evacuating')
    expect(s.shown.reasons.some((r) => r.message === 'ALERTE MAYDAY matérielle déclenchée par le chef de binôme')).toBe(true)
    expect(hudPort.written).toEqual(['{"cmd":"alert","level":"NO-GO"}\n'])
  })

  test('the cylinder going down turns the verdict NO-GO through the PNR, and the HUD is told', async () => {
    const { ctx, s, hudPort } = await rig()
    engage(ctx, s)
    hudPort.send(ari(1, 220))
    await wait()
    await wait()
    expect(s.shown.verdict).toBe('GO')
    hudPort.send(ari(2, 150) + ari(3, 110))
    await wait()
    await wait()
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.shown.reasons.some((r) => r.code === 'AIR_BUDGET' && r.severity === 'no-go')).toBe(true)
    expect(hudPort.written.at(-1)).toBe('{"cmd":"alert","level":"NO-GO"}\n')
  })

  test('only the COS clears it: re-engage sends GO to the HUD, and a room still hot raises NO-GO again with its next packet', async () => {
    const { ctx, s, dronePort, hudPort, gate, pushVerdict } = await rig()
    dronePort.send(drone(1, 48))
    await wait()
    await wait()
    expect(hudPort.written).toEqual(['{"cmd":"alert","level":"NO-GO"}\n'])
    // The COS decides.
    applyAction(ctx, s, { type: 'reengage' })
    gate.clearCritical()
    pushVerdict()
    await wait()
    expect(s.shown.verdict).toBe('GO')
    expect(hudPort.written.at(-1)).toBe('{"cmd":"alert","level":"GO"}\n')
    // The room is still hot: its next packet raises the danger again.
    dronePort.send(drone(2, 48))
    await wait()
    await wait()
    expect(s.shown.verdict).toBe('NO-GO')
    expect(hudPort.written.at(-1)).toBe('{"cmd":"alert","level":"NO-GO"}\n')
  })

  test('boot noise and corrupted lines between packets change nothing', async () => {
    const { s, dronePort, events } = await rig()
    dronePort.send('ets Jul 29 2019 12:21:46\r\nrst:0x1\n{"seq":1,"t_ms\n' + drone(2, 24) + 'garbage\n' + drone(3, 25))
    await wait()
    await wait()
    expect(events).toEqual([])
    expect(s.shown.verdict).toBe('GO')
  })
})
