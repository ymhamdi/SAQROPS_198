// The app's own check on an LLM-reworded answer (the server runs the same rules in server/guard.py): every number
// must come from the WhatIfResult or the template, no spelled-out numbers, same lead word, at most 30 words.

import type { WhatIfResult } from './whatIf'

const NUMBER = /\d+(?:[.:]\d+)?/g
const SPELLED =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter|dozen|couple)\b/i

const canon = (n: string) => (n.includes(':') || !n.includes('.') ? n : n.replace(/0+$/, '').replace(/\.$/, ''))
const lead = (s: string) => s.match(/^\s*(Yes|No|Partly)\b/)?.[1] ?? null

export function wordingOk(text: string, template: string, result: WhatIfResult): boolean {
  const allowed = new Set([...(JSON.stringify(result).match(NUMBER) ?? []), ...(template.match(NUMBER) ?? [])].map(canon))
  if ((text.match(NUMBER) ?? []).some((n) => !allowed.has(canon(n)))) return false
  if (SPELLED.test(text)) return false
  if (lead(template) !== null && lead(text) !== lead(template)) return false
  const words = text.split(/\s+/).filter(Boolean).length
  return words > 0 && words <= 30
}
