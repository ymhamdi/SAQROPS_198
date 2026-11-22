// The serial protocol of the two USB microcontrollers: newline-delimited JSON at 115200 baud (firmware/README.md).
//
//   drone-payload (ESP32), every 500 ms:  temp_bmp280 (°C) and alt_bmp280 (m), with the room the operator selected
//   binome-hud (STM32), every 400 ms:     ari_bar (bar); mayday (bool) the moment it is triggered
//   browser → binome-hud:                 {"cmd":"alert","level":"GO"|"NO-GO"}
//
// A boot banner, a partial line or a corrupted packet is ignored, never thrown: the app must survive any USB noise.

import { H, v } from '../config'
import type { Site } from '../site/site'

export type HwSensor = 'temp_bmp280' | 'alt_bmp280' | 'ari_bar' | 'mayday'

export interface HwMessage {
  seq: number
  /** the device's own clock, ms since it started */
  tMs: number
  source: string
  sensor: HwSensor
  value: number
  unit: string
  room: string
}

export type HudLevel = 'GO' | 'NO-GO'

const SENSORS: readonly string[] = ['temp_bmp280', 'alt_bmp280', 'ari_bar', 'mayday']

/** A packet is about 150 characters: a « line » this long without a newline is noise, not a packet. */
const MAX_LINE_CHARS = 1024

/**
 * One line from a device, or null when it is not a valid packet (boot text, a line cut in two, an unknown sensor, a value
 * that is not a finite number). Never throws.
 */
export function parseLine(line: string): HwMessage | null {
  const text = line.trim()
  if (text.length === 0 || text.length > MAX_LINE_CHARS || text[0] !== '{') return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.sensor !== 'string' || !SENSORS.includes(o.sensor)) return null
  // A mayday is a boolean: 1/0 from the firmware, true/false tolerated.
  const value = o.sensor === 'mayday' && typeof o.value === 'boolean' ? (o.value ? 1 : 0) : o.value
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const seq = typeof o.seq === 'number' && Number.isFinite(o.seq) ? o.seq : -1
  const tMs = typeof o.t_ms === 'number' && Number.isFinite(o.t_ms) ? o.t_ms : -1
  return {
    seq,
    tMs,
    source: typeof o.source === 'string' ? o.source : '',
    sensor: o.sensor as HwSensor,
    value,
    unit: typeof o.unit === 'string' ? o.unit : '',
    room: typeof o.room === 'string' ? o.room : '',
  }
}

/** Splits a byte stream, decoded to text, into lines: a chunk can end in the middle of a packet. */
export class LineBuffer {
  private rest = ''

  /** Feed a chunk; get back the complete lines it finished (without their newline). */
  push(chunk: string): string[] {
    this.rest += chunk
    const parts = this.rest.split('\n')
    this.rest = parts.pop() ?? ''
    // Garbage with no newline must not grow without bound.
    if (this.rest.length > MAX_LINE_CHARS) this.rest = ''
    return parts.map((p) => p.replace(/\r$/, ''))
  }

  reset(): void {
    this.rest = ''
  }
}

/** The line the browser writes to the HUD. */
export function alertLine(level: HudLevel): string {
  return `${JSON.stringify({ cmd: 'alert', level })}\n`
}

/**
 * The room of the demo site a name sent by the firmware stands for (« stockage-solvants » → the solvent store), or null when
 * the name is unknown. The aliases are in data/config.json.
 */
export function roomIndexOf(site: Site, name: string): number | null {
  const aliases = v(H.hardware.roomAliases) as Record<string, string>
  const id = aliases[name] ?? name
  const i = site.rooms.findIndex((r) => r.id === id)
  return i >= 0 ? i : null
}
