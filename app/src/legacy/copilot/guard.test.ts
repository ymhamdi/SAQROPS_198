import { expect, test } from 'vitest'
import { wordingOk } from './guard'
import type { WhatIfResult } from './whatIf'

// Same cases as server/tests/test_explain.py: both guards must agree.
const TEMPLATE = 'Partly. You can stay 15 minutes, not 20: after that you would get back too close to sunset. Head back by 16:36.'
const RESULT = {
  intent: 'extend_stay',
  verdict: 'PARTIAL',
  requested_min: 20,
  allowed_min: 15,
  binding: 'SUNSET',
  numbers: { o2_left_min: 365, pnr_in_min: 245, head_back_by: '16:36', head_back_in_min: 15, sunset_margin_min: 30, dose_msv: 0.09, o2_at_return_min: 300 },
} as unknown as WhatIfResult

test.each([
  TEMPLATE,
  'Partly. Stay 15 minutes, not 20, or you will be back too close to sunset. Leave by 16:36.',
  'Partly: 15 minutes is the most, not 20, because of sunset. Head back by 16:36.',
  'Partly. Stay 15 minutes; your O₂ is 365 minutes. Head back by 16:36.',
])('keeps the facts: %s', (text) => {
  expect(wordingOk(text, TEMPLATE, RESULT)).toBe(true)
})

test.each([
  'Partly. You can stay 18 minutes, not 20. Head back by 16:36.',
  'Partly. Stay 15 minutes, then head back by 16:40.',
  'Partly. Stay fifteen minutes, not twenty. Head back by 16:36.',
  'Yes. You can stay 15 minutes. Head back by 16:36.',
  'Partly. ' + 'really '.repeat(30) + '15 minutes.',
  'Partly. Stay 15 minutes, and you will have 365 minutes of oxygen and 12 to spare.',
  '',
])('changes a fact: %s', (text) => {
  expect(wordingOk(text, TEMPLATE, RESULT)).toBe(false)
})
