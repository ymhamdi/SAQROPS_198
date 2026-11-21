// R6: a NO-GO is latched; only the COS can re-engage, and that action is logged.

import { describe, expect, test } from 'vitest'
import { applyLatch, OPEN_LATCH, reengage } from './latch'
import { verdictOf } from './verdict'

const go = verdictOf([])
const noGo = verdictOf([{ code: 'FLASHOVER_PREDICTED', severity: 'no-go', message: 'Embrasement prévu', source: 'ai', status: 'SIMULATED' }])

describe('R6 NO-GO latch', () => {
  test('GO passes through while the latch is open', () => {
    const { shown, latch } = applyLatch(OPEN_LATCH, go, 10)
    expect(shown.verdict).toBe('GO')
    expect(latch.latched).toBe(false)
  })

  test('a NO-GO closes the latch and is logged', () => {
    const { shown, latch } = applyLatch(OPEN_LATCH, noGo, 20)
    expect(shown.verdict).toBe('NO-GO')
    expect(latch.latched).toBe(true)
    expect(latch.log).toEqual([{ t: 20, action: 'NO-GO', by: 'system', note: 'Embrasement prévu' }])
  })

  test('no automatic return to GO: a computed GO stays NO-GO with the original cause', () => {
    const closed = applyLatch(OPEN_LATCH, noGo, 20).latch
    for (const t of [21, 60, 600]) {
      const { shown, latch } = applyLatch(closed, go, t)
      expect(shown.verdict).toBe('NO-GO')
      expect(shown.reasons[0].code).toBe('LATCHED')
      expect(shown.reasons.some((r) => r.message === 'Embrasement prévu')).toBe(true)
      expect(latch.latched).toBe(true)
    }
  })

  test('only the COS re-engages; the action is logged and the next verdict is shown as computed', () => {
    const closed = applyLatch(OPEN_LATCH, noGo, 20).latch
    const opened = reengage(closed, 95)
    expect(opened.latched).toBe(false)
    expect(opened.log.at(-1)).toMatchObject({ t: 95, action: 'RE-ENGAGE', by: 'COS' })
    expect(applyLatch(opened, go, 96).shown.verdict).toBe('GO')
  })
})
