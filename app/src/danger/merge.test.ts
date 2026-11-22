// R1: the AI can only make a verdict worse (GO → NO-GO), never better.

import { describe, expect, test } from 'vitest'
import { verdictOf, type Reason, type Severity } from '../stats/verdict'
import { mergeAi } from './merge'

const SEVERITIES: Severity[] = ['no-go', 'caution', 'info']

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function reasons(r: () => number, source: Reason['source'], n: number): Reason[] {
  return Array.from({ length: n }, (_, i) => ({
    code: 'ROOM_HOT',
    severity: SEVERITIES[Math.floor(r() * 3)],
    message: `${source}-${i}`,
    source,
    status: 'MODELED',
  }))
}

describe('R1 the AI only degrades a verdict', () => {
  test('2000 random cases: a NO-GO stays NO-GO and no base reason is lost', () => {
    const r = rng(1)
    for (let k = 0; k < 2000; k++) {
      const base = verdictOf(reasons(r, 'rules', Math.floor(r() * 4)))
      const merged = mergeAi(base, reasons(r, 'ai', Math.floor(r() * 4)))
      if (base.verdict === 'NO-GO') expect(merged.verdict).toBe('NO-GO')
      for (const b of base.reasons) expect(merged.reasons).toContainEqual(b)
    }
  })

  test('an AI reason saying all clear cannot lift a NO-GO', () => {
    const base = verdictOf([{ code: 'ROOM_FAILED', severity: 'no-go', message: 'détecteurs hors service', source: 'rules', status: 'SIMULATED' }])
    const merged = mergeAi(base, [{ code: 'FLASHOVER_PREDICTED', severity: 'info', message: 'aucun embrasement prévu', source: 'ai', status: 'SIMULATED' }])
    expect(merged.verdict).toBe('NO-GO')
  })

  test('the AI can turn a GO into a NO-GO', () => {
    const merged = mergeAi(verdictOf([]), [{ code: 'FLASHOVER_PREDICTED', severity: 'no-go', message: 'embrasement prévu', source: 'ai', status: 'SIMULATED' }])
    expect(merged.verdict).toBe('NO-GO')
    expect(merged.reasons[0].source).toBe('ai')
  })
})
