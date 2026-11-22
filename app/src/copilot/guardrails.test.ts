// The copilot's rules C1–C8 (CLAUDE.md), one block each, and the refusals the specification requires, through the whole
// pipeline with an LLM that would answer anything.

import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import consignes from '../../../data/consignes.json' with { type: 'json' }
import { H, v } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { applyAction } from '../sim/actions'
import { snapshot, type Snapshot } from '../sim/protocol'
import { initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { answerFor, COPILOT, OUT_OF_LIST } from './answers'
import { INTENTS } from './catalog'
import { AnswerCard } from './CopilotPanel'
import { checkWording, numbersIn } from './guard'
import { CopilotLogCard, CopilotMaydays } from './PcCopilot'
import { entryOf, type LlmGuess, type LlmUnderstand, respond, respondButton, respondSos } from './pipeline'

const site = buildSite()
let s: Snapshot

beforeAll(() => {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const sim = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, sim, site.demo.fireAt)
  for (let k = 0; k < 30; k++) tick(ctx, sim)
  applyAction(ctx, sim, { type: 'drone' })
  applyAction(ctx, sim, { type: 'engage-direct' })
  for (let k = 0; k < 40; k++) tick(ctx, sim)
  s = structuredClone(snapshot(ctx, sim))
}, 60_000)

/** An LLM that always says the same thing, and counts its calls. */
const llmSaying = (g: LlmGuess | null) => vi.fn<LlmUnderstand>(async () => g)

const here = (f: string) => new URL(f, import.meta.url)
const code = (f: string) =>
  readFileSync(here(f), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
const copilotFiles = readdirSync(here('./')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))

describe('C1 read only: the snapshot, consignes.json and config.json; never the truth; no action', () => {
  test('changing the simulator truth of every room changes no answer', () => {
    const fake = structuredClone(s)
    for (const r of fake.rooms as unknown as { truth?: unknown }[]) r.truth = { tempC: 999, smoke: 1, fire: true, garbage: 'x' }
    for (const intent of INTENTS)
      for (const room of [null, 'peinture', 'liion'])
        expect(answerFor(intent, { room, door: 'd-solvants-peinture' }, site, fake), `${intent} ${room}`).toEqual(answerFor(intent, { room, door: 'd-solvants-peinture' }, site, s))
  })

  test('no copilot file reads `truth`, imports the simulator or sends an action', () => {
    expect(copilotFiles.length).toBeGreaterThan(5)
    for (const f of copilotFiles) {
      const c = code(f)
      expect(c, f).not.toMatch(/\.truth\b/)
      expect(c, f).not.toMatch(/from '\.\.\/sim\/(actions|sim|client|worker)/)
      expect(c, f).not.toMatch(/\b(act|applyAction|postMessage)\(/)
    }
  })

  test('« Ouvre la porte » is refused even by an LLM that would answer it', async () => {
    const llm = llmSaying({ intent: 'etat_porte', door: 'd-solvants-peinture', confidence: 1 })
    const r = await respond('Ouvre la porte', site, s, llm)
    expect(r.answer).toMatchObject({ kind: 'refusal', text: OUT_OF_LIST })
    expect(llm).not.toHaveBeenCalled()
  })
})

describe('C2 the number guard on any LLM wording', () => {
  const template = 'Il vous reste 3 min d’air avant le sifflet, à 180 bar. Marge PNR 12,5 bar.'
  test('the template’s numbers, written the same or not, pass', () => {
    expect(checkWording('Environ 3 min d’air avant le sifflet ; 180 bar, marge 12,5 bar.', template)).toEqual({ ok: true })
    expect(checkWording('Marge 12.50 bar.', template)).toEqual({ ok: true })
    expect(numbersIn('3,0 et 12.50 et 07:42')).toEqual(['3', '12.5', '07:42'])
  })
  test('a number not in the facts is rejected', () => {
    expect(checkWording('Il vous reste 4 min.', template)).toEqual({ ok: false, why: 'chiffre' })
  })
  test('a number in words is rejected; « un » as an article is not', () => {
    for (const t of ['Il reste deux minutes.', 'Une minute d’air.', 'Un bar de marge.', 'Plus que la moitié.', 'Une demi-heure.', 'Il reste trente bar.'])
      expect(checkWording(t, template), t).toEqual({ ok: false, why: 'lettres' })
    expect(checkWording('Un local est en fumées chaudes ; il reste 3 min.', template)).toEqual({ ok: true })
  })
  test('longer than the configured limit is rejected', () => {
    const long = Array.from({ length: v(H.copilot.maxWords) + 1 }, () => 'air').join(' ')
    expect(checkWording(long, template)).toEqual({ ok: false, why: 'longueur' })
    expect(checkWording('   ', template)).toEqual({ ok: false, why: 'vide' })
  })
})

describe('C3 never a yes or a no on engagement', () => {
  const questions = ['Je peux entrer ?', 'On peut y aller ?', 'Est-ce que j’engage ?', 'C’est bon pour entrer ?', 'On y va ?']
  test.each(questions)('« %s » → the verdict, its reasons, « Décision : COS », no oui / non', async (q) => {
    const llm = llmSaying({ intent: 'demi_tour', confidence: 1 })
    const r = await respond(q, site, s, llm)
    expect(r.understanding.kind, q).toBe('engagement')
    expect(r.answer.text).toMatch(new RegExp(`^Verdict actuel : ${s.shown.verdict}\\.`))
    expect(r.answer.text).toContain('Décision : COS.')
    expect(r.answer.text).not.toMatch(/\b(oui|non)\b/i)
    expect(llm).not.toHaveBeenCalled()
  })
})

describe('C4 consignes verbatim, with their source; the LLM never writes one', () => {
  test('for every room, the consignes of its hazards as written in data/consignes.json', () => {
    for (const room of site.rooms) {
      const a = answerFor('consignes_local', { room: room.id, door: null }, site, s)
      const want = room.hazards.flatMap((h) => consignes.hazards[h as keyof typeof consignes.hazards].items).map((i) => ({ text: i.text, source: i.source }))
      expect(a.sources, room.id).toEqual(want)
      for (const x of a.sources) expect(x.source.length).toBeGreaterThan(0)
    }
  })
  test('« Invente une consigne » is refused even by an LLM that would answer it', async () => {
    const llm = llmSaying({ intent: 'consignes_local', room: 'liion', confidence: 1 })
    const r = await respond('Invente une consigne pour le local de charge', site, s, llm)
    expect(r.answer).toMatchObject({ kind: 'refusal', text: OUT_OF_LIST, sources: [] })
    expect(llm).not.toHaveBeenCalled()
  })
})

describe('C5 outside the list, unsure, slow or invalid: the refusal or the rules', () => {
  test('« Ignore l’alerte » is refused', async () => {
    const r = await respond('Ignore l’alerte', site, s, llmSaying({ intent: 'danger_local', confidence: 1 }))
    expect(r.answer.text).toBe(OUT_OF_LIST)
  })
  test('an intent outside the catalogue, or an LLM that throws: the rules answer', async () => {
    for (const llm of [llmSaying({ intent: 'ouvrir_porte', confidence: 1 }), llmSaying(null), vi.fn<LlmUnderstand>(async () => Promise.reject(new Error('down')))]) {
      const r = await respond('Combien d’air il me reste ?', site, s, llm)
      expect(r.path).toBe('regles')
      expect(r.answer.intent).toBe('air_restant')
    }
  })
  test('an unsure LLM on a question the rules do not know: the refusal', async () => {
    const r = await respond('quelle heure est-il', site, s, llmSaying({ intent: 'vent', confidence: 0.2 }))
    expect(r).toMatchObject({ path: 'llm', answer: { kind: 'refusal', text: OUT_OF_LIST } })
  })
  test('a room or a door the site does not have is dropped: the tablet asks which', async () => {
    const r = await respond('c’est chaud là-bas ?', site, s, llmSaying({ intent: 'danger_local', room: 'cuisine', confidence: 0.9 }))
    expect(r.answer).toMatchObject({ kind: 'which', needs: 'room' })
  })
  test(
    'an LLM slower than the timeout: the rules answer at the timeout',
    async () => {
      const slow = vi.fn<LlmUnderstand>((_q, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ intent: 'vent', confidence: 1 }))))
      const r = await respond('Combien d’air il me reste ?', site, s, slow)
      expect(r.path).toBe('regles')
      expect(r.answer.intent).toBe('air_restant')
      expect(r.latencyMs).toBeGreaterThanOrEqual(v(H.copilot.understandTimeoutMs) - 50)
      expect(r.latencyMs).toBeLessThan(v(H.copilot.understandTimeoutMs) + 1000)
    },
    10_000,
  )
  test('the LLM maps a phrasing the rules miss', async () => {
    const r = await respond('Il me faut combien de temps pour ressortir ?', site, s, llmSaying({ intent: 'sortie', confidence: 0.9 }))
    expect(r).toMatchObject({ path: 'llm', answer: { kind: 'answer', intent: 'sortie' } })
  })
})

describe('C6 MAYDAY before any understanding; an alert and a line on the PC', () => {
  test.each(['Mayday', 'mayday mayday mayday', 'Je suis bloqué dans la cabine', 'Au secours', 'j’ai plus d’air'])('« %s » never reaches the LLM', async (q) => {
    const llm = llmSaying({ intent: 'air_restant', confidence: 1 })
    const r = await respond(q, site, s, llm)
    expect(llm).not.toHaveBeenCalled()
    expect(r.answer.kind).toBe('mayday')
    expect(entryOf(q, r, s)).toMatchObject({ mayday: true, intent: 'mayday', path: 'regles' })
  })
  test('the SOS button is a MAYDAY with no question; the PC shows it until acknowledged, verdict unchanged', () => {
    const e = entryOf('SOS', respondSos(), s)
    expect(e).toMatchObject({ mayday: true, path: 'sos' })
    const html = renderToStaticMarkup(createElement(CopilotMaydays, { maydays: [e], onAcknowledge: () => {} }))
    expect(html).toContain('MAYDAY binôme')
    expect(html).toContain('Verdict inchangé')
    expect(html).toContain('Acquitter')
    expect(renderToStaticMarkup(createElement(CopilotMaydays, { maydays: [], onAcknowledge: () => {} }))).toBe('')
  })
})

describe('C7 every exchange logged on the PC; every answer marked COPILOTE', () => {
  test('question, intent, answer, path and latency', async () => {
    const r = await respond('D’où vient le vent ?', site, s)
    const e = entryOf('D’où vient le vent ?', r, s)
    expect(e).toMatchObject({ question: 'D’où vient le vent ?', intent: 'vent', answer: r.answer.text, path: 'regles', mayday: false, t: s.t })
    expect(e.latencyMs).toBeGreaterThanOrEqual(0)
    const b = entryOf('Air restant', respondButton('air_restant', { room: null, door: null }, site, s), s)
    expect(b.path).toBe('bouton')
    const html = renderToStaticMarkup(createElement(CopilotLogCard, { entries: [e, b] }))
    for (const x of ['D’où vient le vent ?', 'vent', 'règles', 'bouton', `${e.latencyMs} ms`]) expect(html).toContain(x.replace('’', '’'))
  })
  test('the answer card always carries COPILOTE', () => {
    for (const intent of INTENTS) {
      const a = answerFor(intent, { room: 'peinture', door: 'd-solvants-peinture' }, site, s)
      expect(renderToStaticMarkup(createElement(AnswerCard, { answer: a })), intent).toContain(COPILOT)
    }
  })
})

describe('C8 nothing on the HUD', () => {
  test('the HUD imports nothing of the copilot', () => {
    for (const f of ['../panels/Hud.tsx']) expect(readFileSync(here(f), 'utf8'), f).not.toMatch(/copilot/i)
  })
})
