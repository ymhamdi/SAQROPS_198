// What a hardware packet does. Two separate things, on purpose:
//
//  - `decide` turns a packet into an event for the simulation: a critical room, a mayday, a live air pressure. Hardware can
//    only AGGRAVATE (R13, as the AI is for R1 and the drone for R9): a temperature that falls, a reading below the threshold,
//    a mayday of 0, a packet that never comes, all produce NO event. Nothing in this file can ever lower a danger.
//  - `reduceTelemetry` keeps what the panel shows: the drone's room, its readings, the air, the mayday.
//
// Every value says where it comes from: live from the USB link it is OBSERVED, played back from a recording it is REPLAY.

import { H, v } from '../config'
import type { Site } from '../site/site'
import { worstStatus } from '../stats/status'
import type { DataStatus } from '../types'
import { roomIndexOf, type HwMessage } from './protocol'

export type HwOrigin = 'live' | 'replay'
export type HwStatus = 'OBSERVED' | 'REPLAY'

export const statusOf = (origin: HwOrigin): HwStatus => (origin === 'replay' ? 'REPLAY' : 'OBSERVED')

/** What the operator can set in the panel. */
export interface HwSettings {
  /** reading of the drone payload above which a room is a critical danger, °C */
  triggerThresholdC: number
  /** factor of the MODELED value shown beside the observed one (demo scaling) */
  demoFactor: number
}

export const defaultSettings = (): HwSettings => ({ triggerThresholdC: v(H.hardware.triggerThresholdC), demoFactor: v(H.hardware.demoFactor) })

/** An event for the simulation. There is no event that lowers anything. */
export type HardwareEvent =
  /** `room` is null when the firmware named a room the site does not know: still a danger, for the whole site */
  | { kind: 'critical-room'; room: number | null; roomName: string; valueC: number; thresholdC: number; status: HwStatus }
  | { kind: 'mayday'; status: HwStatus }
  /** the live air pressure, bar */
  | { kind: 'ari'; bar: number; status: HwStatus }

/** The simulation's reaction to one packet, or null when the packet cannot make anything worse. */
export function decide(msg: HwMessage, origin: HwOrigin, settings: HwSettings, site: Site): HardwareEvent | null {
  const status = statusOf(origin)
  if (msg.sensor === 'temp_bmp280') {
    // Below the threshold, nothing: a cooler reading is no news, and never a reason to relax.
    if (!Number.isFinite(settings.triggerThresholdC) || msg.value < settings.triggerThresholdC) return null
    return { kind: 'critical-room', room: roomIndexOf(site, msg.room), roomName: msg.room, valueC: msg.value, thresholdC: settings.triggerThresholdC, status }
  }
  if (msg.sensor === 'mayday') return msg.value === 1 ? { kind: 'mayday', status } : null
  if (msg.sensor === 'ari_bar') return { kind: 'ari', bar: Math.min(Math.max(0, msg.value), v(H.ari.startBar)), status }
  return null
}

export interface Telemetry {
  drone: { room: string | null; roomIndex: number | null; tempC: number | null; altM: number | null; lastAtMs: number | null }
  hud: { ariBar: number | null; lastAtMs: number | null; mayday: boolean }
  /** where the latest packet came from: the live link or a recording */
  origin: HwOrigin | null
}

export const initialTelemetry = (): Telemetry => ({
  drone: { room: null, roomIndex: null, tempC: null, altM: null, lastAtMs: null },
  hud: { ariBar: null, lastAtMs: null, mayday: false },
  origin: null,
})

/** What the panel shows after a packet. `nowMs` is the browser's clock, to tell a silent device from a talking one. */
export function reduceTelemetry(t: Telemetry, msg: HwMessage, origin: HwOrigin, site: Site, nowMs: number): Telemetry {
  const next: Telemetry = { drone: { ...t.drone }, hud: { ...t.hud }, origin }
  if (msg.sensor === 'temp_bmp280' || msg.sensor === 'alt_bmp280') {
    // The drone's place follows the room its packets name.
    if (msg.room) {
      next.drone.room = msg.room
      next.drone.roomIndex = roomIndexOf(site, msg.room)
    }
    if (msg.sensor === 'temp_bmp280') next.drone.tempC = msg.value
    else next.drone.altM = msg.value
    next.drone.lastAtMs = nowMs
  } else if (msg.sensor === 'ari_bar') {
    next.hud.ariBar = msg.value
    next.hud.lastAtMs = nowMs
  } else if (msg.sensor === 'mayday') {
    // A mayday is not withdrawn by a packet: only the COS's decision clears it.
    next.hud.mayday = t.hud.mayday || msg.value === 1
    next.hud.lastAtMs = nowMs
  }
  return next
}

/** True when a device has said nothing for staleAfterS. Silence is shown, and never read as « all is well ». */
export function isSilent(lastAtMs: number | null, nowMs: number): boolean {
  return lastAtMs !== null && nowMs - lastAtMs > v(H.hardware.staleAfterS) * 1000
}

/**
 * The label of the scaled value (observed × factor): it is a model of what a real fire would give, so never better than
 * MODELED; when the reading itself is a replay it is REPLAY (worstStatus keeps the weaker of the two).
 */
export function scaledStatus(origin: HwOrigin): DataStatus {
  return worstStatus(statusOf(origin), 'MODELED')
}
