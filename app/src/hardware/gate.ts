// A stream of packets is not a stream of actions. The simulation hears an event only when it says something new, and « new »
// is always an aggravation: a room not yet marked, a reading higher than the last sent, a first mayday, a different pressure.
// A falling or steady reading passes nothing (it could not lower a danger anyway: R13). When the COS clears the dangers, the
// gate forgets them, so that a room still hot raises its danger again with its next packet.

import type { HardwareEvent } from './ingest'

export class EventGate {
  private critical = new Map<string, number>()
  private mayday = false
  private ari = NaN

  /** True when the event should reach the simulation. */
  pass(ev: HardwareEvent): boolean {
    if (ev.kind === 'critical-room') {
      const key = String(ev.room ?? ev.roomName)
      if ((this.critical.get(key) ?? -Infinity) >= ev.valueC) return false
      this.critical.set(key, ev.valueC)
      return true
    }
    if (ev.kind === 'mayday') {
      if (this.mayday) return false
      this.mayday = true
      return true
    }
    const rounded = Math.round(ev.bar)
    if (rounded === this.ari) return false
    this.ari = rounded
    return true
  }

  /** The COS has cleared the critical rooms. */
  clearCritical(): void {
    this.critical.clear()
  }

  /** The COS has cleared the mayday. */
  clearMayday(): void {
    this.mayday = false
  }

  /** A new session (a replay starts): nothing has been sent. */
  reset(): void {
    this.critical.clear()
    this.mayday = false
    this.ari = NaN
  }
}
