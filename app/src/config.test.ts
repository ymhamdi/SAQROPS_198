// R4: every assumption lives in data/config.json with a source and a status.

import { describe, expect, test } from 'vitest'
import { allHypotheses } from './config'
import { DATA_STATUSES } from './types'

describe('R4 data/config.json', () => {
  const all = allHypotheses()

  test('holds the hypotheses', () => {
    expect(all.length).toBeGreaterThan(40)
  })

  test.each(all)('%s has a value, a unit, a source and a valid status', (_, h) => {
    expect(h.value).not.toBeUndefined()
    expect(typeof h.unit).toBe('string')
    expect(h.source.trim().length).toBeGreaterThan(10)
    expect(DATA_STATUSES).toContain(h.status)
  })
})
