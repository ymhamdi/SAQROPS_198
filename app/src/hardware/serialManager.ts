// Two USB devices through the Web Serial API (Chrome, Edge): the drone payload and the binôme HUD. 100 % client side, no
// server. It keeps one reader loop per port, splits the byte stream into lines, parses them (never throwing on noise) and
// tells the app. A USB unplug or a failing write ends that device's session, never the app.
//
// `navigator.serial` is not in the TypeScript DOM types and not in Node: the manager works on the small interface below, so
// the tests drive it with fake ports and no hardware.

import { alertLine, LineBuffer, parseLine, type HudLevel, type HwMessage } from './protocol'

export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
}

export interface SerialApi {
  requestPort(): Promise<SerialPortLike>
}

export type Role = 'drone' | 'hud'
export type DeviceState = 'disconnected' | 'connected' | 'replay'

export interface DeviceStatus {
  state: DeviceState
  /** the manager's clock when the last valid packet arrived */
  lastPacketAtMs: number | null
  /** why the last attempt or session failed, in French, for the panel */
  error: string | null
}

export interface ManagerOptions {
  api: SerialApi | null
  baudRate: number
  now: () => number
  /** a valid packet came from a device */
  onMessage: (role: Role, msg: HwMessage) => void
  /** a status changed: re-render */
  onChange: () => void
}

export type SendResult = 'sent' | 'skipped' | 'no-hud' | 'error'

/** The Web Serial API of this browser, or null (Firefox, Safari, an insecure page). */
export function browserSerial(): SerialApi | null {
  const s = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { serial?: SerialApi }).serial
  return s ?? null
}

const fresh = (): DeviceStatus => ({ state: 'disconnected', lastPacketAtMs: null, error: null })
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class SerialManager {
  status: Record<Role, DeviceStatus> = { drone: fresh(), hud: fresh() }
  private ports: Partial<Record<Role, SerialPortLike>> = {}
  private readers: Partial<Record<Role, ReadableStreamDefaultReader<Uint8Array>>> = {}
  private lastSent: HudLevel | null = null
  private writes: Promise<unknown> = Promise.resolve()
  private replay = false

  private readonly opts: ManagerOptions

  constructor(opts: ManagerOptions) {
    this.opts = opts
  }

  supported(): boolean {
    return this.opts.api !== null
  }

  private set(role: Role, patch: Partial<DeviceStatus>) {
    this.status = { ...this.status, [role]: { ...this.status[role], ...patch } }
    this.opts.onChange()
  }

  /** Ask the user for a port (a browser dialog) and start reading it. Returns whether the device is now connected. */
  async connect(role: Role): Promise<boolean> {
    const { api } = this.opts
    if (!api) {
      this.set(role, { error: 'Web Serial indisponible : utilisez Chrome ou Edge.' })
      return false
    }
    if (this.ports[role]) return true
    let port: SerialPortLike
    try {
      port = await api.requestPort()
    } catch (e) {
      // The user closed the dialog, or no port was offered: not an error of the app.
      this.set(role, { error: `Aucun port choisi (${messageOf(e)})` })
      return false
    }
    try {
      await port.open({ baudRate: this.opts.baudRate })
    } catch (e) {
      this.set(role, { error: `Ouverture impossible : ${messageOf(e)}` })
      return false
    }
    if (!port.readable) {
      this.set(role, { error: 'Le port ne se lit pas.' })
      await port.close().catch(() => {})
      return false
    }
    this.ports[role] = port
    if (role === 'hud') this.lastSent = null
    this.set(role, { state: 'connected', error: null })
    void this.readLoop(role, port)
    return true
  }

  /** One reader per port: bytes → text → lines → packets, until the stream ends, is cancelled or the cable is pulled. */
  private async readLoop(role: Role, port: SerialPortLike) {
    const reader = port.readable!.getReader()
    this.readers[role] = reader
    const decoder = new TextDecoder()
    const lines = new LineBuffer()
    let error: string | null = null
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        for (const line of lines.push(decoder.decode(value, { stream: true }))) {
          const msg = parseLine(line)
          if (!msg) continue
          this.set(role, { lastPacketAtMs: this.opts.now() })
          this.opts.onMessage(role, msg)
        }
      }
    } catch (e) {
      // A cable pulled out mid-read ends up here: the session is over, the app goes on.
      error = `Liaison perdue : ${messageOf(e)}`
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // already released
      }
      delete this.readers[role]
      delete this.ports[role]
      if (role === 'hud') this.lastSent = null
      await port.close().catch(() => {})
      this.set(role, { state: this.replay ? 'replay' : 'disconnected', error })
    }
  }

  async disconnect(role: Role): Promise<void> {
    await this.readers[role]?.cancel().catch(() => {})
  }

  /** While a recording plays, the devices are shown as « replay »: nothing they show is live. */
  setReplay(on: boolean) {
    this.replay = on
    for (const role of ['drone', 'hud'] as const) {
      if (on && this.status[role].state === 'disconnected') this.set(role, { state: 'replay' })
      else if (!on && this.status[role].state === 'replay') this.set(role, { state: 'disconnected' })
    }
  }

  /**
   * Tell the HUD the verdict. One line per change (not one per tick); `force` sends it anyway (the test button). Writes are
   * queued so that two quick alerts never fight for the port's writer.
   */
  sendHudAlert(level: HudLevel, opts: { force?: boolean } = {}): Promise<SendResult> {
    const run = async (): Promise<SendResult> => {
      const port = this.ports.hud
      if (!port || !port.writable || this.status.hud.state !== 'connected') return 'no-hud'
      if (!opts.force && this.lastSent === level) return 'skipped'
      const writer = port.writable.getWriter()
      try {
        await writer.write(new TextEncoder().encode(alertLine(level)))
        this.lastSent = level
        return 'sent'
      } catch (e) {
        this.lastSent = null
        this.set('hud', { error: `Écriture impossible : ${messageOf(e)}` })
        return 'error'
      } finally {
        writer.releaseLock()
      }
    }
    const result = this.writes.then(run, run)
    this.writes = result
    return result
  }
}
