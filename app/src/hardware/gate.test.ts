// The gate between the packets and the simulation: only an aggravation passes, and the COS's decision makes it forget.

import { describe, expect, test } from 'vitest'
import { EventGate } from './gate'
import type { HardwareEvent } from './ingest'

const hot = (room: number | null, valueC: number): HardwareEvent => ({ kind: 'critical-room', room, roomName: 'r', valueC, thresholdC: 35, status: 'OBSERVED' })

describe('EventGate', () => {
  test('a new room passes, the same reading again does not, a higher one does, a lower one does not', () => {
    const g = new EventGate()
    expect(g.pass(hot(3, 40))).toBe(true)
    expect(g.pass(hot(3, 40))).toBe(false)
    expect(g.pass(hot(3, 39))).toBe(false)
    expect(g.pass(hot(3, 41))).toBe(true)
    expect(g.pass(hot(4, 36))).toBe(true)
  })

  test('the first mayday passes, the next ones do not', () => {
    const g = new EventGate()
    expect(g.pass({ kind: 'mayday', status: 'OBSERVED' })).toBe(true)
    expect(g.pass({ kind: 'mayday', status: 'OBSERVED' })).toBe(false)
  })

  test('the air pressure passes when it changes by a bar, not when it jitters in the decimals', () => {
    const g = new EventGate()
    const ari = (bar: number): HardwareEvent => ({ kind: 'ari', bar, status: 'OBSERVED' })
    expect(g.pass(ari(200.2))).toBe(true)
    expect(g.pass(ari(199.8))).toBe(false)
    expect(g.pass(ari(199))).toBe(true)
  })

  test('when the COS clears the dangers, a room still hot passes again', () => {
    const g = new EventGate()
    g.pass(hot(3, 48))
    g.pass({ kind: 'mayday', status: 'OBSERVED' })
    g.clearCritical()
    expect(g.pass(hot(3, 48))).toBe(true)
    expect(g.pass({ kind: 'mayday', status: 'OBSERVED' })).toBe(false)
    g.clearMayday()
    expect(g.pass({ kind: 'mayday', status: 'OBSERVED' })).toBe(true)
  })

  test('a room the site does not know is told apart by its name', () => {
    const g = new EventGate()
    expect(g.pass({ kind: 'critical-room', room: null, roomName: 'cave', valueC: 50, thresholdC: 35, status: 'OBSERVED' })).toBe(true)
    expect(g.pass({ kind: 'critical-room', room: null, roomName: 'cave', valueC: 50, thresholdC: 35, status: 'OBSERVED' })).toBe(false)
    expect(g.pass({ kind: 'critical-room', room: null, roomName: 'puits', valueC: 50, thresholdC: 35, status: 'OBSERVED' })).toBe(true)
  })

  test('reset forgets everything (a new replay)', () => {
    const g = new EventGate()
    g.pass(hot(3, 48))
    g.reset()
    expect(g.pass(hot(3, 48))).toBe(true)
  })
})
