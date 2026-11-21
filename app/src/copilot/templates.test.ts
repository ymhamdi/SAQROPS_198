import { describe, expect, test } from 'vitest'
import { answerText, clarifyText, forSpeech, shortName, spokenMinutes, wordCount } from './templates'
import type { WhatIfResult } from './whatIf'

const NUMBERS = {
  o2_left_min: 312,
  pnr_in_min: 47,
  head_back_by: '14:35',
  head_back_in_min: 15,
  sunset_margin_min: 95,
  dose_msv: 0.12,
  o2_at_return_min: 125,
}

function r(over: Partial<WhatIfResult>): WhatIfResult {
  return {
    intent: 'extend_stay',
    verdict: 'GO',
    requested_min: 20,
    allowed_min: 35,
    binding: 'POINT_OF_NO_RETURN',
    reasons: [],
    subject: 'Final-phase workspace (Mollecita, Monte Cielo)',
    next_is_home: false,
    status: 'MODELED',
    apply: null,
    ...over,
    numbers: { ...NUMBERS, ...over.numbers },
  }
}

/** Every answer the templates can give, worst-case long names included. */
const CASES: WhatIfResult[] = [
  r({}),
  r({ verdict: 'PARTIAL', allowed_min: 15, next_is_home: true }),
  r({ requested_min: null, allowed_min: 140 }),
  r({ verdict: 'NO_GO', allowed_min: 0, numbers: { ...NUMBERS, pnr_in_min: -5 } }),
  r({ verdict: 'NO_GO', allowed_min: 0, binding: 'SUNSET' }),
  r({ verdict: 'NO_GO', binding: 'ALREADY_LEFT' }),
  r({ intent: 'add_stop', numbers: { ...NUMBERS, extra_min: 34 }, binding: null }),
  r({ intent: 'add_stop', verdict: 'NO_GO', numbers: { ...NUMBERS, extra_min: 148 }, binding: 'O2_BUDGET' }),
  r({ intent: 'add_stop', verdict: 'NO_GO', binding: 'ALREADY_PLANNED' }),
  r({ intent: 'skip_stop', numbers: { ...NUMBERS, saved_min: 41 }, binding: null }),
  r({ intent: 'skip_stop', verdict: 'NO_GO', numbers: { ...NUMBERS, saved_min: 41 }, binding: 'RADIATION' }),
  r({ intent: 'time_left', binding: 'POINT_OF_NO_RETURN', numbers: { ...NUMBERS, head_back_in_min: 47 } }),
  r({ intent: 'time_left', binding: 'SUNSET', numbers: { ...NUMBERS, head_back_in_min: 22 } }),
  r({ intent: 'time_left', verdict: 'NO_GO', binding: 'POINT_OF_NO_RETURN' }),
  r({ intent: 'go_home', subject: 'the rover at Nevado Sajama (ridge drill site)', numbers: { ...NUMBERS, to_safety_min: 12, distance_m: 420, spare_o2_min: 180 } }),
  r({ intent: 'go_home', verdict: 'NO_GO', binding: 'NO_HAVEN' }),
  r({ intent: 'unknown' }),
]

describe('spoken answers', () => {
  test.each(CASES.map((c) => [`${c.intent} ${c.verdict} ${c.binding}`, c]))('%s: at most 30 words and 2 sentences after the lead', (_, c) => {
    const text = answerText(c as WhatIfResult)
    expect(wordCount(text)).toBeLessThanOrEqual(30)
    const body = text.replace(/^(Yes|No|Partly)\.\s*/, '')
    const sentences = body.split(/[.?!](?=\s|$)/).filter((s) => s.trim())
    expect(sentences.length).toBeLessThanOrEqual(2)
  })

  test('decision answers start with Yes / No / Partly', () => {
    for (const c of CASES.filter((x) => ['extend_stay', 'add_stop', 'skip_stop'].includes(x.intent))) {
      expect(answerText(c)).toMatch(/^(Yes|No|Partly)\./)
    }
  })

  test('the PARTIAL stay reads as specified', () => {
    expect(answerText(r({ verdict: 'PARTIAL', allowed_min: 15, next_is_home: true }))).toBe(
      'Partly. You can stay 15 minutes, not 20: after that the walk home would cut into your O₂ reserve. Head back by 14:35.',
    )
  })

  test('every number said is a number of the result', () => {
    for (const c of CASES) {
      const allowed = new Set(JSON.stringify(c).match(/\d+(\.\d+)?/g))
      for (const n of answerText(c).match(/\d+(\.\d+)?/g) ?? []) {
        const derived = [...allowed].some((a) => {
          const m = Number(a)
          return a === n || (m >= 90 && (String(Math.floor(m / 60)) === n || String(m % 60) === n))
        })
        expect(derived, `${n} in "${answerText(c)}"`).toBe(true)
      }
    }
  })
})

test('helpers', () => {
  expect(spokenMinutes(1)).toBe('1 minute')
  expect(spokenMinutes(89)).toBe('89 minutes')
  expect(spokenMinutes(125)).toBe('2 hours 5 minutes')
  expect(spokenMinutes(120)).toBe('2 hours')
  expect(shortName('Nevado Sajama (ridge drill site)')).toBe('Nevado Sajama')
  expect(clarifyText(['A', 'B', 'C'])).toBe('Which one: A, B or C?')
  expect(forSpeech('O₂ left 420 m')).toBe('oxygen left 420 meters')
})
