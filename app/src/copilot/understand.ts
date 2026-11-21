// From a spoken question to {intent, minutes, target}: a deterministic rule parser (always available; the fallback
// when the LLM is down, slow or wrong) and the checks applied to whatever the LLM returns. Place names are matched
// against the CURRENT targets and stops, never a hard-coded list.

import { clarifyText } from './templates'
import type { Intent, StopState } from './whatIf'
import { INTENTS } from './whatIf'

export interface PlaceRef {
  id: string
  name: string
}

export interface StopRef extends PlaceRef {
  state: StopState
}

/** What the understanding stage knows about the walk (also sent to the server for the LLM). */
export interface UnderstandContext {
  /** every science target in the site data */
  targets: PlaceRef[]
  /** the plan's stops, in order, with where the crew is */
  stops: StopRef[]
  current_stop_id: string | null
  /** "T+2:15" */
  eva_clock: string
}

/** Output of the understanding stage (rules or LLM), before the deterministic checks. */
export interface Understood {
  intent: Intent
  minutes: number | null
  target_id: string | null
  clarify_question: string | null
}

/** After the checks: either a question to compute, or a short clarifying question back to the crew. */
export type Resolution =
  | { kind: 'ask'; intent: Intent; minutes: number | null; targetId: string | null }
  | { kind: 'clarify'; intent: Intent; minutes: number | null; options: PlaceRef[]; question: string }

// ---------- text normalisation ----------

const FILLERS = /\b(uh+|um+|er+|erm+|hmm+|uh-huh|you know|i mean|okay|ok|so|well|hey|copilot|co-pilot|please|like)\b/g

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** Lower case, no punctuation (digits and ':' kept), number words as digits, fillers removed. */
export function normalise(text: string): string {
  let t = text.toLowerCase().replace(/[’‘]/g, "'").replace(/o₂|o2\b/g, 'oxygen')
  t = t.replace(/[^a-z0-9:'\s-]/g, ' ').replace(/-/g, ' ')
  t = t.replace(FILLERS, ' ')
  // "twenty five" → 25, "fifteen" → 15, "a couple of" → 2
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(TENS[a] + UNITS[b]))
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (w) => String(TENS[w]))
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/g, (w) => String(UNITS[w]))
  t = t.replace(/\ba couple( of)?\b/g, '2')
  return t.replace(/\s+/g, ' ').trim()
}

// ---------- minutes ----------

/** Minutes asked for, from normalised text: "20 more minutes", "half an hour", "an hour and a half", "1 hour 20". */
export function parseMinutes(t: string): number | null {
  if (/\b(an?|1) hour and a half\b|\bhour and a half\b/.test(t)) return 90
  if (/\bhalf (an )?hour\b/.test(t)) return 30
  if (/\b(a )?quarter (of an )?hour\b/.test(t)) return 15
  let total: number | null = null
  const h = t.match(/\b(\d+(?:\.\d+)?|an?)\s*(and a half\s*)?(hours?|hrs?)\b/)
  if (h) total = (h[1] === 'a' || h[1] === 'an' ? 1 : Number(h[1])) * 60 + (h[2] ? 30 : 0)
  const m = t.match(/\b(\d+)\s*(more|extra|additional)?\s*(minutes?|mins?)\b/) ?? t.match(/\b(?:another|extra|additional)\s+(\d+)\b/) ?? t.match(/\b(\d+)\s+more\b/)
  if (m) total = (total ?? 0) + Number(m[1])
  if (total !== null && h !== null && !m) {
    // "1 hour 20": minutes after the hours count without a unit
    const after = t.match(/\bhours?\s+(\d+)\b/)
    if (after) total += Number(after[1])
  }
  if (total === null) {
    // "stay here for 10" (a stay question with a bare number)
    const bare = t.match(/\bfor (\d{1,3})\b/)
    if (bare) total = Number(bare[1])
  }
  return total !== null && total > 0 ? Math.round(total) : null
}

// ---------- intent ----------

const SKIP = /\b(skip|drop|cancel|scrap|leave out|cut out|bypass|miss out|forget about|not go to|don'?t go to|without (going to|visiting)|pass on)\b/
const STAY =
  /\b(stay|remain|linger|hang (around|out|on)|spend|keep working|work (a bit |a little )?longer|extend|more time|extra time|bit more time|(a bit|a little|bit|little) longer|longer here|how (much )?longer can (we|i))\b|\b\d+\s*(more|extra|additional)\s*(minutes?|mins?)\b|\b(another|extra|additional)\s+(\d+|half|hour|quarter)\b/
const TIME_LEFT = /\bhow (long|much (more )?time)\b.*\b(until|till|before|left|have|got|remaining)\b|\bturn (back|around)\b|\btime (left|remaining)\b|\bpoint of no return\b|\bpnr\b|\b(oxygen) (left|remaining)\b|\bhow much oxygen\b|\bwhen (do|must|should|have|need) (we|i)\b.*\b(leave|go back|head back|turn back|return|head home|go home)\b/
const GO_HOME = /\b(fastest|quickest|shortest|best|safest)\b.*\b(way|route|path|walk)\b.*\b(back|home|habitat|rover|safety|shelter|base)\b|\b(way|route|path) (back|home)\b|\b(get|take|lead|bring|guide) (us|me) (back|home|to safety)\b|\babort\b|\bbail out\b|\b(go|head|return|walk) (back )?(home|to (the )?(habitat|rover|base|shelter|safety))\b|\bnearest (safe haven|haven|shelter)\b/
const ADD = /\b(also|add|visit|stop (by|at)|swing by|go (to|by|see)|check out|detour|include|squeeze in|fit in|drop by|pop over|see)\b/

/** Intent from normalised text, by rules. Order matters: "stay 20 more before we turn back" is a stay question. */
export function ruleIntent(t: string): Intent {
  if (SKIP.test(t)) return 'skip_stop'
  if (STAY.test(t)) return 'extend_stay'
  if (TIME_LEFT.test(t)) return 'time_left'
  // "swing by X on the way back" is a detour, not a request to go home.
  if (GO_HOME.test(t.replace(/\bon (the|our) way (back|home)\b/g, ' '))) return 'go_home'
  if (ADD.test(t)) return 'add_stop'
  return 'unknown'
}

// ---------- places ----------

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'on', 'at', 'in', 'to', 'and', 'for', 'de', 'la', 'del', 'el', 'site', 'up', 'close', 'msl', 'via', 't'])

const stem = (w: string) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)

function tokens(s: string): string[] {
  return normalise(s)
    .split(/[\s:]+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem)
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** Whether a place token appears in the text tokens (exact, one typo for long words, or split in two: "alta dena"). */
function mentions(words: string[], token: string): boolean {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w === token) return true
    if (token.length >= 6 && w.length >= 5 && editDistanceAtMost1(w, token)) return true
    if (i + 1 < words.length && w + words[i + 1] === token) return true
  }
  return false
}

/**
 * Places the text names, best first. Each place token is weighted by how rare it is among the candidates (1 / number
 * of candidates that share it), so "altadena" beats "drill" and "ridge" alone stays ambiguous between all ridges.
 */
export function matchPlaces(text: string, places: PlaceRef[]): { best: PlaceRef[]; score: number } {
  const words = normalise(text).split(/[\s:]+/).filter(Boolean).map(stem)
  const placeTokens = places.map((p) => [...new Set([...tokens(p.name), ...tokens(p.id.replace(/^[a-z]+-/, ''))])])
  const df = new Map<string, number>()
  for (const ts of placeTokens) for (const t of ts) df.set(t, (df.get(t) ?? 0) + 1)
  const scores = placeTokens.map((ts) => ts.reduce((s, t) => (mentions(words, t) ? s + 1 / df.get(t)! : s), 0))
  const top = Math.max(0, ...scores)
  if (top === 0) return { best: [], score: 0 }
  return { best: places.filter((_, i) => Math.abs(scores[i] - top) < 1e-9), score: top }
}

// normalise() has already turned "one" into "1".
const HERE = /\b(here|this (stop|spot|place|site|1)|where we are|right now)\b/
const NEXT = /\b(next (stop|1|site|target)|the next)\b/
const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|number 1)\b/, 0],
  [/\b(second|2nd|number 2)\b/, 1],
  [/\b(third|3rd|number 3)\b/, 2],
  [/\b(fourth|4th|number 4)\b/, 3],
]

// ---------- the rule parser ----------

/** Deterministic understanding of one utterance. Places are resolved later, against the context, by resolve(). */
export function parseRules(text: string, _ctx?: UnderstandContext): Understood {
  const t = normalise(text)
  const intent = ruleIntent(t)
  return { intent, minutes: intent === 'extend_stay' ? parseMinutes(t) : null, target_id: null, clarify_question: null }
}

const isIntent = (x: unknown): x is Intent => typeof x === 'string' && (INTENTS as readonly string[]).includes(x)

/**
 * Whether the words say an amount of time at all (digits, number words, "half", "hour"…, or an accented "tventy").
 * The LLM invents minutes for "can we stay longer?" (30, in the eval); without a cue its minutes are dropped.
 */
export function hasNumberCue(text: string): boolean {
  const t = text.toLowerCase().replace(/\b(safety|plenty|pretty|empty|party)\b/g, ' ')
  return /\d|\w(teen|ty)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|half|hours?|quarter|couple|dozen)\b/.test(t)
}

/**
 * The deterministic checks on an understanding (from the LLM or the rules): intent and minutes sanity, and the place.
 * Places named in the text are resolved here first (unique → that one; tied → ask which); the LLM's target is used
 * only when the text names nothing we can match.
 */
export function resolve(text: string, u: Understood, ctx: UnderstandContext, rules: Understood = parseRules(text, ctx)): Resolution {
  let intent: Intent = isIntent(u.intent) ? u.intent : 'unknown'
  if (intent === 'unknown' && rules.intent !== 'unknown') intent = rules.intent
  const t = normalise(text)
  const validMin = (m: number | null) => (m !== null && Number.isFinite(m) && m > 0 && m <= 240 ? Math.round(m) : null)
  // The LLM's minutes only when the words name an amount; otherwise the rules' (or none: "how long can we stay?").
  const minutes = intent === 'extend_stay' ? ((hasNumberCue(text) ? validMin(u.minutes) : null) ?? validMin(rules.minutes)) : null
  const ask = (targetId: string | null): Resolution => ({ kind: 'ask', intent, minutes, targetId })
  const clarify = (options: PlaceRef[], question?: string): Resolution => ({
    kind: 'clarify',
    intent,
    minutes,
    options,
    question: question ?? (options.length > 0 && options.length <= 4 ? clarifyText(options.map((o) => o.name)) : 'Which stop? Say its name.'),
  })

  const ahead = ctx.stops.filter((s) => s.state !== 'done')
  const onPlan = new Set(ctx.stops.map((s) => s.id))
  const known = new Set([...ctx.targets.map((x) => x.id), ...ctx.stops.map((x) => x.id)])
  const llmTarget = u.target_id && known.has(u.target_id) ? u.target_id : null

  /** Match the text against a first-choice set of places, then all places; ambiguity inside a set → clarify. */
  const pick = (first: PlaceRef[], all: PlaceRef[]): { id: string | null; tie: PlaceRef[] | null } => {
    for (const set of [first, all]) {
      if (set.length === 0) continue
      const m = matchPlaces(text, set)
      if (m.best.length === 1) return { id: m.best[0].id, tie: null }
      if (m.best.length > 1) return { id: null, tie: m.best }
    }
    return { id: null, tie: null }
  }
  const everything: PlaceRef[] = [...ctx.stops, ...ctx.targets.filter((x) => !onPlan.has(x.id))]

  switch (intent) {
    case 'extend_stay': {
      if (HERE.test(t) && !ahead.some((s) => matchPlaces(text, [s]).score > 0)) return ask(ctx.current_stop_id)
      if (NEXT.test(t)) return ask(ahead.find((s) => s.state === 'next')?.id ?? null)
      const m = pick(ahead, everything)
      if (m.tie) return clarify(m.tie)
      return ask(m.id ?? llmTarget ?? ctx.current_stop_id)
    }
    case 'skip_stop': {
      if (HERE.test(t) && ctx.current_stop_id) return ask(ctx.current_stop_id)
      if (NEXT.test(t)) return ask(ahead.find((s) => s.state === 'next')?.id ?? null)
      const m = pick(ahead, everything)
      if (m.tie) return clarify(m.tie)
      const id = m.id ?? llmTarget
      if (id) return ask(id)
      if (ahead.length === 1) return ask(ahead[0].id)
      return clarify(ahead)
    }
    case 'add_stop': {
      const notOnPlan = ctx.targets.filter((x) => !onPlan.has(x.id))
      const m = pick(notOnPlan, ctx.targets)
      if (m.tie) return clarify(m.tie)
      const id = m.id ?? llmTarget
      if (id) return ask(id)
      return clarify(notOnPlan, u.clarify_question ?? undefined)
    }
    default:
      return ask(null)
  }
}

/** The answer to a clarifying question: a name among the options, or "the first / second one". Null if neither. */
export function resolveClarify(text: string, options: PlaceRef[]): string | null {
  const t = normalise(text)
  const m = matchPlaces(text, options)
  if (m.best.length === 1) return m.best[0].id
  for (const [re, i] of ORDINALS) if (re.test(t) && options[i]) return options[i].id
  if (/\b(last|final) (one|stop)\b/.test(t)) return options[options.length - 1]?.id ?? null
  return null
}

/** "Confirm" / "apply" said right after an answer: apply the change the answer offered. */
export function isConfirm(text: string): boolean {
  return /^(yes )?(confirm(ed)?|apply( it| that)?|do it|go ahead|make it so)\b/.test(normalise(text))
}
