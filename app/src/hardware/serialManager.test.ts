// The Web Serial manager, driven by fake ports: no hardware needed. Packets cut at any byte, boot noise, a cable pulled out,
// quick alerts to the HUD, a browser without Web Serial, a user who cancels the port dialog.

import { describe, expect, test } from 'vitest'
import type { HwMessage } from './protocol'
import { SerialManager, type Role, type SerialApi, type SerialPortLike } from './serialManager'

const enc = new TextEncoder()
const tick = () => new Promise((r) => setTimeout(r, 0))

/** A port whose incoming bytes the test controls, and whose writes it records. */
class FakePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  written: string[] = []
  opened: { baudRate: number } | null = null
  closed = false
  private controller!: ReadableStreamDefaultController<Uint8Array>
  failWrites = false

  constructor() {
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => (this.controller = c) })
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.failWrites) throw new Error('device gone')
        this.written.push(new TextDecoder().decode(chunk))
      },
    })
  }
  async open(o: { baudRate: number }) {
    this.opened = o
  }
  async close() {
    this.closed = true
  }
  send(text: string) {
    this.controller.enqueue(enc.encode(text))
  }
  /** The cable is pulled: the read fails. */
  unplug() {
    this.controller.error(new Error('The device has been lost.'))
  }
}

function setup(ports: FakePort[] = [new FakePort()]) {
  const queue = [...ports]
  const api: SerialApi = {
    requestPort: async () => {
      const p = queue.shift()
      if (!p) throw new Error('No port selected')
      return p
    },
  }
  const got: { role: Role; msg: HwMessage }[] = []
  let changes = 0
  let clock = 1000
  const m = new SerialManager({ api, baudRate: 115200, now: () => clock++, onMessage: (role, msg) => got.push({ role, msg }), onChange: () => changes++ })
  return { m, got, ports, changes: () => changes }
}

const PKT = (n: number, c: number) => `{"seq":${n},"t_ms":${n * 500},"source":"drone-payload","sensor":"temp_bmp280","value":${c},"unit":"C","room":"atelier"}\n`

describe('reading a device', () => {
  test('connects at the configured speed and delivers the packets, whatever the chunking', async () => {
    const { m, got, ports } = setup()
    expect(await m.connect('drone')).toBe(true)
    expect(ports[0].opened).toEqual({ baudRate: 115200 })
    expect(m.status.drone.state).toBe('connected')
    const text = PKT(1, 24) + PKT(2, 25.5) + PKT(3, 27)
    // Cut in the middle of packets, three bytes at a time.
    for (let i = 0; i < text.length; i += 3) ports[0].send(text.slice(i, i + 3))
    await tick()
    await tick()
    expect(got.map((g) => g.msg.value)).toEqual([24, 25.5, 27])
    expect(got.every((g) => g.role === 'drone')).toBe(true)
    expect(m.status.drone.lastPacketAtMs).not.toBeNull()
  })

  test('boot banners and corrupted lines are skipped, the packets around them are not lost', async () => {
    const { m, got, ports } = setup()
    await m.connect('drone')
    ports[0].send('ets Jul 29 2019\r\nrst:0x1 (POWERON_RESET)\n' + PKT(1, 30) + '{"seq":2,"t_ms\n' + PKT(3, 31))
    await tick()
    await tick()
    expect(got.map((g) => g.msg.value)).toEqual([30, 31])
  })

  test('a cable pulled out ends that device’s session without throwing, and it can be connected again', async () => {
    const a = new FakePort()
    const b = new FakePort()
    const { m, got } = setup([a, b])
    await m.connect('drone')
    a.send(PKT(1, 30))
    await tick()
    a.unplug()
    await tick()
    await tick()
    expect(m.status.drone.state).toBe('disconnected')
    expect(m.status.drone.error).toMatch(/Liaison perdue/)
    expect(a.closed).toBe(true)
    // The packets received before the unplug are kept, and a new session works.
    expect(got).toHaveLength(1)
    expect(await m.connect('drone')).toBe(true)
    b.send(PKT(5, 40))
    await tick()
    await tick()
    expect(got.map((g) => g.msg.value)).toEqual([30, 40])
  })

  test('two devices at once: each packet is attributed to its own port', async () => {
    const d = new FakePort()
    const h = new FakePort()
    const { m, got } = setup([d, h])
    await m.connect('drone')
    await m.connect('hud')
    d.send(PKT(1, 30))
    h.send('{"seq":9,"t_ms":1,"source":"binome-hud","sensor":"ari_bar","value":180,"unit":"bar","room":"binome-1"}\n')
    await tick()
    await tick()
    expect(got.map((g) => [g.role, g.msg.sensor])).toEqual(expect.arrayContaining([['drone', 'temp_bmp280'], ['hud', 'ari_bar']]))
  })

  test('disconnect closes the port cleanly', async () => {
    const { m, ports } = setup()
    await m.connect('drone')
    await m.disconnect('drone')
    await tick()
    await tick()
    expect(m.status.drone.state).toBe('disconnected')
    expect(ports[0].closed).toBe(true)
  })
})

describe('when it cannot connect', () => {
  test('a browser without Web Serial: said in French, nothing thrown', async () => {
    const m = new SerialManager({ api: null, baudRate: 115200, now: () => 0, onMessage: () => {}, onChange: () => {} })
    expect(m.supported()).toBe(false)
    expect(await m.connect('drone')).toBe(false)
    expect(m.status.drone.error).toMatch(/Chrome ou Edge/)
    expect(await m.sendHudAlert('NO-GO')).toBe('no-hud')
  })

  test('the user cancels the port dialog: not connected, no crash', async () => {
    const { m } = setup([])
    expect(await m.connect('hud')).toBe(false)
    expect(m.status.hud.state).toBe('disconnected')
    expect(m.status.hud.error).toMatch(/Aucun port/)
  })

  test('a port that will not open is reported', async () => {
    const p = new FakePort()
    p.open = async () => {
      throw new Error('Access denied')
    }
    const { m } = setup([p])
    expect(await m.connect('drone')).toBe(false)
    expect(m.status.drone.error).toMatch(/Ouverture impossible/)
  })
})

describe('the alert to the HUD', () => {
  async function withHud() {
    const s = setup()
    await s.m.connect('hud')
    return { ...s, hud: s.ports[0] }
  }

  test('writes exactly {"cmd":"alert","level":...} and a newline', async () => {
    const { m, hud } = await withHud()
    expect(await m.sendHudAlert('NO-GO')).toBe('sent')
    expect(hud.written.join('')).toBe('{"cmd":"alert","level":"NO-GO"}\n')
  })

  test('one line per change: the same level twice is sent once, a change is sent', async () => {
    const { m, hud } = await withHud()
    expect(await m.sendHudAlert('NO-GO')).toBe('sent')
    expect(await m.sendHudAlert('NO-GO')).toBe('skipped')
    expect(await m.sendHudAlert('GO')).toBe('sent')
    expect(await m.sendHudAlert('GO')).toBe('skipped')
    expect(hud.written).toEqual(['{"cmd":"alert","level":"NO-GO"}\n', '{"cmd":"alert","level":"GO"}\n'])
  })

  test('the test button forces a send even when the level did not change', async () => {
    const { m, hud } = await withHud()
    await m.sendHudAlert('NO-GO')
    expect(await m.sendHudAlert('NO-GO', { force: true })).toBe('sent')
    expect(hud.written).toHaveLength(2)
  })

  test('quick alerts are queued in order and never fight for the writer', async () => {
    const { m, hud } = await withHud()
    const results = await Promise.all([m.sendHudAlert('NO-GO'), m.sendHudAlert('GO'), m.sendHudAlert('NO-GO')])
    expect(results).toEqual(['sent', 'sent', 'sent'])
    expect(hud.written.map((w) => JSON.parse(w).level)).toEqual(['NO-GO', 'GO', 'NO-GO'])
  })

  test('with no HUD connected there is nothing to send to', async () => {
    const { m } = setup()
    expect(await m.sendHudAlert('NO-GO')).toBe('no-hud')
  })

  test('a failing write is reported and does not throw; the alert is never recorded as sent, so it is tried again', async () => {
    const { m, hud } = await withHud()
    hud.failWrites = true
    expect(await m.sendHudAlert('NO-GO')).toBe('error')
    expect(m.status.hud.error).toMatch(/Écriture impossible/)
    // A port whose write failed is a lost device: the next attempt fails too (never « skipped » as if it had been sent),
    // until the HUD is connected again.
    expect(await m.sendHudAlert('NO-GO')).toBe('error')
  })

  test('a HUD that connects after the verdict changed gets it again', async () => {
    const a = new FakePort()
    const b = new FakePort()
    const { m } = setup([a, b])
    await m.connect('hud')
    await m.sendHudAlert('NO-GO')
    a.unplug()
    await tick()
    await tick()
    await m.connect('hud')
    expect(await m.sendHudAlert('NO-GO')).toBe('sent')
    expect(b.written).toEqual(['{"cmd":"alert","level":"NO-GO"}\n'])
  })
})

describe('replay mode', () => {
  test('devices that are not plugged show as replay, and back to disconnected', () => {
    const { m } = setup()
    m.setReplay(true)
    expect(m.status.drone.state).toBe('replay')
    expect(m.status.hud.state).toBe('replay')
    m.setReplay(false)
    expect(m.status.drone.state).toBe('disconnected')
  })
})
