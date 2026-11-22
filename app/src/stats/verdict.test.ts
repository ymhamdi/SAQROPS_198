// R2: every verdict shown on the PC, the tablet and the card carries « Décision : COS »; the HUD shows a short word.

import { describe, expect, test } from 'vitest'
import { DECISION_COS, verdictLine, verdictOf } from './verdict'

const go = verdictOf([])
const noGo = verdictOf([{ code: 'FLASHOVER_PREDICTED', severity: 'no-go', message: 'Embrasement prévu Cabine de peinture dans ~45 s', source: 'ai', status: 'SIMULATED' }])

describe('R2 verdict wording', () => {
  test.each(['pc', 'tablet', 'card'] as const)('%s: GO and NO-GO both carry « Décision : COS »', (surface) => {
    expect(verdictLine(go, surface)).toContain(DECISION_COS)
    expect(verdictLine(noGo, surface)).toContain(DECISION_COS)
    expect(verdictLine(noGo, surface)).toContain('Embrasement prévu')
  })

  test('HUD: one short word, no sentence', () => {
    expect(verdictLine(go, 'hud')).toBe('GO')
    expect(verdictLine(noGo, 'hud')).toBe('NO-GO')
  })
})
