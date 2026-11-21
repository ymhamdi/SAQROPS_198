import { describe, expect, test } from 'vitest'
import { hasNumberCue, isConfirm, matchPlaces, normalise, parseMinutes, parseRules, resolve, resolveClarify, type UnderstandContext } from './understand'

// The Curiosity boxwork stops in data/processed/gale/science_targets.json (names copied; the app reads them live).
const TARGETS = [
  { id: 'msl-first-ridge', name: 'First boxwork ridge close-up' },
  { id: 'msl-altadena', name: 'Altadena drill site' },
  { id: 'msl-nodules', name: 'Nodules on a ridge wall' },
  { id: 'msl-panorama', name: 'Boxwork panorama viewpoint' },
  { id: 'msl-valle-de-la-luna', name: 'Valle de la Luna (hollow drill site)' },
  { id: 'msl-nevado-sajama', name: 'Nevado Sajama (ridge drill site)' },
  { id: 'msl-final-phase', name: 'Final-phase workspace (Mollecita, Monte Cielo)' },
]

const CTX: UnderstandContext = {
  targets: TARGETS,
  stops: [
    { id: 'msl-altadena', name: 'Altadena drill site', state: 'current' },
    { id: 'msl-nodules', name: 'Nodules on a ridge wall', state: 'next' },
  ],
  current_stop_id: 'msl-altadena',
  eva_clock: 'T+1:10',
}

const ask = (text: string) => resolve(text, parseRules(text, CTX), CTX)

describe('normalise and minutes', () => {
  test.each([
    ['Can we stay 20 more minutes?', 20],
    ['uh, can we, um, stay like twenty more minutes', 20],
    ['another fifteen', 15],
    ['half an hour more', 30],
    ['an hour and a half', 90],
    ['one hour twenty minutes', 80],
    ['1 hour 20', 80],
    ['twenty-five more minutes', 25],
    ['can we stay here for 10', 10],
    ['how long can we stay', null],
  ])('%s → %s', (text, minutes) => {
    expect(parseMinutes(normalise(text))).toBe(minutes)
  })
})

describe('intents by rules', () => {
  test.each([
    ['We found something interesting at the ridge. Can we stay 20 more minutes?', 'extend_stay'],
    ['How long can we stay here?', 'extend_stay'],
    ['Can we also visit Nevado Sajama?', 'add_stop'],
    ['Is there time to go to the panorama viewpoint?', 'add_stop'],
    ['What if we skip the nodules?', 'skip_stop'],
    ['Let us drop the next stop', 'skip_stop'],
    ['How long until we must turn back?', 'time_left'],
    ['How much oxygen do we have left?', 'time_left'],
    ['Fastest way back?', 'go_home'],
    ['Get us home', 'go_home'],
    ['What is the weather on Earth?', 'unknown'],
  ])('%s → %s', (text, intent) => {
    expect(parseRules(text, CTX).intent).toBe(intent)
  })
})

describe('places', () => {
  test('a distinctive name wins over shared words', () => {
    expect(matchPlaces('the ridge drill site', TARGETS).best.map((t) => t.id)).toEqual(['msl-nevado-sajama'])
    expect(matchPlaces('alta dena', TARGETS).best.map((t) => t.id)).toEqual(['msl-altadena'])
    expect(matchPlaces('nevado sahama', TARGETS).best.map((t) => t.id)).toEqual(['msl-nevado-sajama'])
  })

  test('"the ridge" is ambiguous between the three ridge targets → a short clarifying question', () => {
    const r = resolve('Can we also visit the ridge?', parseRules('Can we also visit the ridge?', CTX), CTX)
    expect(r.kind).toBe('clarify')
    if (r.kind !== 'clarify') return
    expect(r.options.map((o) => o.id).sort()).toEqual(['msl-first-ridge', 'msl-nevado-sajama'])
    expect(r.question).toMatch(/^Which one: .+ or .+\?$/)
  })

  test('the clarifying answer picks by name or by order', () => {
    const options = TARGETS.filter((t) => /ridge/.test(t.name))
    expect(resolveClarify('the drill site one', options)).toBe('msl-nevado-sajama')
    expect(resolveClarify('the first one', options)).toBe(options[0].id)
    expect(resolveClarify('banana', options)).toBeNull()
  })

  test('stay "here" is the current stop; a named stop ahead is that stop', () => {
    expect(ask('Can we stay here 20 more minutes?')).toEqual({ kind: 'ask', intent: 'extend_stay', minutes: 20, targetId: 'msl-altadena' })
    expect(ask('Can we stay 10 more minutes at the nodules?')).toMatchObject({ targetId: 'msl-nodules', minutes: 10 })
  })

  test('skip with one stop ahead needs no name', () => {
    const one: UnderstandContext = { ...CTX, current_stop_id: null, stops: [{ ...CTX.stops[0], state: 'done' }, CTX.stops[1]] }
    expect(resolve('what if we skip it', parseRules('what if we skip it', one), one)).toMatchObject({ kind: 'ask', intent: 'skip_stop', targetId: 'msl-nodules' })
  })

  test('the LLM target is used only when the text names nothing; an id it made up is dropped', () => {
    const llm = { intent: 'add_stop' as const, minutes: null, target_id: 'msl-panorama', clarify_question: null }
    expect(resolve('can we go see that thing too', llm, CTX)).toMatchObject({ kind: 'ask', targetId: 'msl-panorama' })
    expect(resolve('can we go see Altadena too', llm, CTX)).toMatchObject({ kind: 'ask', targetId: 'msl-altadena' })
    const madeUp = { ...llm, target_id: 'olympus-mons' }
    expect(resolve('can we go see that thing too', madeUp, CTX).kind).toBe('clarify')
  })

  test('an LLM "unknown" is overridden by a confident rule; bad minutes are dropped', () => {
    const llm = { intent: 'unknown' as const, minutes: 9999, target_id: null, clarify_question: null }
    expect(resolve('Can we stay 20 more minutes?', llm, CTX)).toMatchObject({ intent: 'extend_stay', minutes: 20 })
  })
})

describe('minutes the LLM invents are dropped (the 4 minute misses of the LLM eval)', () => {
  const llm = (minutes: number) => ({ intent: 'extend_stay' as const, minutes, target_id: null, clarify_question: null })
  test.each([
    ['Can we stay longer at the nodules?', 30, null],
    ['can we stay a bit linger at Altadena', 30, null],
    ['Can ve stay tventy more minutes?', 20, 20], // accent: the LLM is right, and "tventy" is a cue
    ['Can we get another half hour here?', 30, 30],
    ['For safety, can we stay longer?', 30, null],
  ])('%s (LLM said %i) → %s', (text, said, expected) => {
    expect(resolve(text, llm(said), CTX)).toMatchObject({ minutes: expected })
  })

  test('number cue', () => {
    expect(hasNumberCue('stay 20 more')).toBe(true)
    expect(hasNumberCue('another half hour')).toBe(true)
    expect(hasNumberCue('stay a bit longer')).toBe(false)
  })
})

test('confirm', () => {
  expect(isConfirm('Confirm')).toBe(true)
  expect(isConfirm('yes, do it')).toBe(true)
  expect(isConfirm('apply')).toBe(true)
  expect(isConfirm('can we stay longer')).toBe(false)
})
