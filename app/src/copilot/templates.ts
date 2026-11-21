// The copilot's spoken answer, built only from a WhatIfResult: one lead word (Yes / No / Partly) for the decision
// questions, then at most two short sentences and 30 words. Deterministic; the LLM may only rephrase it (and must keep
// its numbers).

import type { Binding, WhatIfResult } from './whatIf'

/** Plain-words clause for the limit that binds: "after that <clause>". */
const AFTER: Record<string, string> = {
  O2_BUDGET: 'you would dip into the O₂ reserve',
  POINT_OF_NO_RETURN: 'the walk home would cut into your O₂ reserve',
  SUNSET: 'you would get back too close to sunset',
  RADIATION: 'you would still be outside when the radiation alert starts',
}

/** Why the answer is No, as a short sentence. */
const BECAUSE: Record<string, string> = {
  O2_BUDGET: 'the O₂ reserve would not hold',
  POINT_OF_NO_RETURN: 'the walk home would cut into your O₂ reserve',
  SUNSET: 'you would get back too close to sunset',
  RADIATION: 'a radiation alert is in effect',
  DARK_START: 'the sun is not up',
  NO_PATH: 'there is no walkable path',
  NO_GO_CELLS: 'the route crosses impassable ground',
  NO_HAVEN: 'there is no walkable way to a safe haven',
  NO_PATH_TO_TARGET: 'there is no walkable path to it',
}

/** The limit's short name, for "the limit is 35 minutes, set by <name>". */
const LIMIT_NAME: Record<string, string> = {
  O2_BUDGET: 'the O₂ budget',
  POINT_OF_NO_RETURN: 'the point of no return',
  SUNSET: 'sunset',
  RADIATION: 'the radiation alert',
}

const after = (b: Binding | null) => (b && AFTER[b]) || 'a safety limit would break'
const because = (b: Binding | null) => (b && BECAUSE[b]) || 'a safety limit would break'

/** "15 minutes", "1 minute", "2 hours 5 minutes". */
export function spokenMinutes(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 90) return `${m} ${m === 1 ? 'minute' : 'minutes'}`
  const h = Math.floor(m / 60)
  const r = m % 60
  return `${h} ${h === 1 ? 'hour' : 'hours'}${r ? ` ${r} ${r === 1 ? 'minute' : 'minutes'}` : ''}`
}

/** "20 more minutes", "1 more minute", "2 hours 5 minutes more". */
function moreMinutes(min: number): string {
  const m = Math.max(0, Math.round(min))
  return m < 90 ? `${m} more ${m === 1 ? 'minute' : 'minutes'}` : `${spokenMinutes(m)} more`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A place name as spoken: without its parenthetical ("Nevado Sajama (ridge drill site)" → "Nevado Sajama"). */
export function shortName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name
}

/** The result with its subject shortened for speech. */
const spoken = (r: WhatIfResult): WhatIfResult => (r.subject ? { ...r, subject: shortName(r.subject) } : r)

/** "at Altadena drill site" or "" for "here". */
function atPlace(r: WhatIfResult): string {
  return r.subject && r.subject !== 'here' ? ` at ${r.subject}` : ''
}

/** " Head back by 14:35, in 40 minutes." The minutes are left out when they repeat the stay just said. */
function leave(r: WhatIfResult, saidMin: number | null): string {
  const n = r.numbers
  if (!n.head_back_by) return ''
  const verb = r.next_is_home ? 'Head back' : 'Move on'
  const inMin = n.head_back_in_min
  return inMin === null || inMin === saidMin ? ` ${verb} by ${n.head_back_by}.` : ` ${verb} by ${n.head_back_by}, in ${spokenMinutes(inMin)}.`
}

function extendStay(r: WhatIfResult): string {
  const allowed = r.allowed_min ?? 0
  const req = r.requested_min
  if (r.binding && ['NOT_ON_PLAN', 'ALREADY_LEFT', 'WALK_DONE'].includes(r.binding)) return notApplicable(r)
  if (r.verdict === 'NO_GO') {
    if (r.binding === 'POINT_OF_NO_RETURN' && r.numbers.pnr_in_min < 0) return 'No. You are already past the point of no return. Head back now.'
    return `No. You need to leave now: any longer and ${after(r.binding)}.`
  }
  if (r.verdict === 'PARTIAL') return `Partly. You can stay ${spokenMinutes(allowed)}, not ${req}: after that ${after(r.binding)}.${leave(r, allowed)}`
  if (req === null) return `Yes. Up to ${moreMinutes(allowed)}${atPlace(r)}; then ${after(r.binding)}.${leave(r, allowed)}`
  const limit = r.binding ? `; the limit is ${spokenMinutes(allowed)}, set by ${LIMIT_NAME[r.binding] ?? 'a safety limit'}` : ''
  return `Yes. Stay ${moreMinutes(req)}${atPlace(r)}${limit}.${leave(r, req)}`
}

function addStop(r: WhatIfResult): string {
  const n = r.numbers
  if (r.binding && ['ALREADY_PLANNED', 'ALREADY_VISITED', 'UNKNOWN_PLACE', 'WALK_DONE'].includes(r.binding)) return notApplicable(r)
  if (r.binding === 'NO_PATH_TO_TARGET') return `No. ${cap(because(r.binding))}: ${r.subject} is cut off from here.`
  const extra = spokenMinutes(n.extra_min ?? 0)
  if (r.verdict === 'GO') return `Yes. ${r.subject} adds ${extra}; you would be back with ${spokenMinutes(n.o2_at_return_min ?? 0)} of O₂ above the reserve.`
  return `No. ${r.subject} adds ${extra}, and then ${after(r.binding)}.`
}

function skipStop(r: WhatIfResult): string {
  const n = r.numbers
  if (r.binding && ['NOT_ON_PLAN', 'ALREADY_VISITED', 'WALK_DONE'].includes(r.binding)) return notApplicable(r)
  if (r.binding === 'NO_PATH_TO_TARGET') return `No. Without ${r.subject} there is no walkable path for the rest of the plan.`
  const saved = spokenMinutes(n.saved_min ?? 0)
  if (r.verdict === 'GO') return `Yes. Skipping ${r.subject} saves ${saved} of walking and O₂; you would be back by ${n.head_back_by}.`
  return `No. Skipping ${r.subject} saves ${saved}, but ${because(r.binding)}.`
}

function timeLeft(r: WhatIfResult): string {
  const n = r.numbers
  if (r.binding === 'NO_HAVEN') return 'No. There is no walkable way to a safe haven from here. Call the habitat.'
  if (r.verdict === 'NO_GO') {
    if (r.binding === 'RADIATION') return 'No time left: a radiation alert is coming. Head to shelter now.'
    if (r.binding === 'SUNSET') return 'No time left: you must head back now to beat sunset.'
    return 'No time left: you are past the point of no return. Head back now.'
  }
  const reason = r.binding === 'SUNSET' ? 'to beat sunset' : r.binding === 'RADIATION' ? 'to beat the radiation alert' : 'to keep your O₂ reserve'
  return `You have ${spokenMinutes(n.head_back_in_min ?? 0)} before you must turn back, by ${n.head_back_by}, ${reason}. O₂ left: ${spokenMinutes(n.o2_left_min)}.`
}

function goHome(r: WhatIfResult): string {
  const n = r.numbers
  if (r.binding === 'NO_HAVEN') return 'No. There is no walkable way to a safe haven from here. Call the habitat.'
  const where = `Head to ${r.subject}: ${n.distance_m} meters, ${spokenMinutes(n.to_safety_min ?? 0)}.`
  if (r.verdict === 'GO') return `${where} You would arrive with ${spokenMinutes(n.spare_o2_min ?? 0)} of O₂ above the reserve.`
  return `${where} At the slow pace that cuts into the O₂ reserve: go now.`
}

function notApplicable(r: WhatIfResult): string {
  const name = r.subject ?? 'that place'
  switch (r.binding) {
    case 'WALK_DONE':
      return 'The Marswalk is complete: you are back at the habitat.'
    case 'NOT_ON_PLAN':
      return `No. ${name} is not a stop on this plan.`
    case 'ALREADY_LEFT':
      return `No. You have already left ${name}.`
    case 'ALREADY_PLANNED':
      return `Yes. ${name} is already on the plan.`
    case 'ALREADY_VISITED':
      return `No. You have already been to ${name}.`
    case 'UNKNOWN_PLACE':
      return 'No. I do not know that place.'
    default:
      return `No. ${cap(because(r.binding))}.`
  }
}

/** What the copilot can answer, said when the question is not one of them. */
export const CAPABILITIES =
  'I can answer: can we stay longer, add or skip a stop, how long until we turn back, or the fastest way home.'

/** The spoken answer for a result. */
export function answerText(result: WhatIfResult): string {
  const r = spoken(result)
  switch (r.intent) {
    case 'extend_stay':
      return extendStay(r)
    case 'add_stop':
      return addStop(r)
    case 'skip_stop':
      return skipStop(r)
    case 'time_left':
      return timeLeft(r)
    case 'go_home':
      return goHome(r)
    default:
      return CAPABILITIES
  }
}

/** "Which one: A, B or C?" */
export function clarifyText(names: string[]): string {
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? 'which stop')
  return `Which one: ${list}?`
}

/** Text as the speech synthesiser should read it (symbols spelled out). */
export function forSpeech(text: string): string {
  return text
    .replace(/O₂/g, 'oxygen')
    .replace(/\bmSv\b/g, 'millisieverts')
    .replace(/(\d+)\s?m\b/g, '$1 meters')
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
