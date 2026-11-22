// The copilot without any LLM (step 1): the catalogue, the rules, the answers built from a real snapshot, and the panel.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, test } from 'vitest'
import consignes from '../../../data/consignes.json' with { type: 'json' }
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { applyAction } from '../sim/actions'
import { snapshot, type Snapshot } from '../sim/protocol'
import { initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { DECISION_COS } from '../stats/verdict'
import { answerFor, delayBand, OUT_OF_LIST } from './answers'
import { CATALOG, INTENTS } from './catalog'
import { CopilotPanel } from './CopilotPanel'
import { normalise, understandRules } from './rules'

const site = buildSite()
let engaged: Snapshot

beforeAll(() => {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  for (let k = 0; k < 30; k++) tick(ctx, s)
  applyAction(ctx, s, { type: 'drone' })
  applyAction(ctx, s, { type: 'engage-direct' })
  for (let k = 0; k < 40; k++) tick(ctx, s)
  engaged = structuredClone(snapshot(ctx, s))
}, 60_000)

describe('the catalogue', () => {
  test('ten intents, each with a button and examples', () => {
    expect(CATALOG.map((e) => e.intent)).toEqual([...INTENTS])
    for (const e of CATALOG) expect(e.examples.length).toBeGreaterThan(0)
  })

  test('every example of the specification is understood by the rules alone', () => {
    for (const e of CATALOG)
      for (const q of e.examples) {
        const u = understandRules(q, site)
        expect(u.kind, q).toBe('intent')
        if (u.kind === 'intent') expect(u.intent, q).toBe(e.intent)
      }
  })

  test('rooms by their site name or a crew word, doors by the rooms they join', () => {
    const room = (q: string) => {
      const u = understandRules(q, site)
      return u.kind === 'intent' ? u.room : null
    }
    expect(room('Quel danger dans la cabine de peinture ?')).toBe('peinture')
    expect(room('Que faire près du local Li-ion ?')).toBe('liion')
    expect(room('Le TGBT ?')).toBe('tgbt')
    expect(room('consignes tableau électrique')).toBe('tgbt')
    expect(room('danger stockage solvants')).toBe('solvants')
    const door = understandRules('la porte entre le stockage et la cabine est ouverte ?', site)
    expect(door.kind === 'intent' && door.door).toBe('d-solvants-peinture')
    expect(normalise('D’où vient le VENT ?')).toBe('d ou vient le vent')
  })
})

describe('the refusals of the specification, by the rules alone', () => {
  test('« Je peux entrer ? » is an engagement question (C3)', () => {
    expect(understandRules('Je peux entrer ?', site).kind).toBe('engagement')
    expect(understandRules('On y va ?', site).kind).toBe('engagement')
  })
  test('« Ouvre la porte », « Ignore l’alerte », « Invente une consigne » are outside the list (C1, C5)', () => {
    for (const q of ['Ouvre la porte', 'Ignore l’alerte', 'Invente une consigne'])
      expect(understandRules(q, site), q).toEqual({ kind: 'hors_liste', why: 'ordre' })
  })
  test('« Mayday » and its sisters are caught before any understanding (C6)', () => {
    for (const q of ['Mayday', 'mayday mayday', 'SOS', 'je suis bloqué', 'Je suis perdu !', 'j’ai plus d’air'])
      expect(understandRules(q, site).kind, q).toBe('mayday')
  })
  test('anything else is outside the list (C5)', () => {
    expect(understandRules('quelle heure est-il', site)).toEqual({ kind: 'hors_liste', why: 'inconnu' })
    expect(OUT_OF_LIST).toBe('Je ne réponds qu’aux questions de la liste. Demandez au COS.')
  })
})

describe('the answers, from the snapshot the tablet receives', () => {
  test('every intent answers, every number of an answer is labelled', () => {
    for (const intent of INTENTS) {
      const a = answerFor(intent, { room: 'peinture', door: 'd-solvants-peinture' }, site, engaged)
      expect(a.text.length, intent).toBeGreaterThan(0)
      for (const i of a.items) expect(['OBSERVED', 'DERIVED', 'MODELED', 'SIMULATED', 'MOCK'], `${intent} ${i.label}`).toContain(i.status)
    }
  })

  test('air: the pressure the tablet shows, and an air time before the whistle labelled MODELED or weaker', () => {
    const a = answerFor('air_restant', { room: null, door: null }, site, engaged)
    expect(a.items[0]).toMatchObject({ label: 'Pression ARI', value: engaged.team.bar, unit: 'bar' })
    expect(['MODELED', 'SIMULATED']).toContain(a.items[1].status)
    expect(a.text).toContain(`${Math.round(engaged.team.bar)} bar`)
  })

  test('why the verdict: the reasons as written, and « Décision : COS »', () => {
    const a = answerFor('pourquoi_verdict', { room: null, door: null }, site, engaged)
    expect(a.text).toContain(`Verdict actuel : ${engaged.shown.verdict}`)
    expect(a.text).toContain(DECISION_COS)
  })

  test('consignes: every one as written in data/consignes.json, with its source (C4)', () => {
    const a = answerFor('consignes_local', { room: 'liion', door: null }, site, engaged)
    const expected = site.rooms.find((r) => r.id === 'liion')!.hazards.flatMap((h) => consignes.hazards[h as keyof typeof consignes.hazards].items)
    expect(a.sources).toEqual(expected.map((i) => ({ text: i.text, source: i.source })))
  })

  test('a room or a door question without one asks which', () => {
    expect(answerFor('danger_local', { room: null, door: null }, site, engaged)).toMatchObject({ kind: 'which', needs: 'room' })
    expect(answerFor('etat_porte', { room: null, door: null }, site, engaged)).toMatchObject({ kind: 'which', needs: 'door' })
  })

  test('the AI delay is never given to the second: three bands', () => {
    expect([delayBand(10), delayBand(59), delayBand(60), delayBand(120), delayBand(121)]).toEqual([
      'moins d’1 min',
      'moins d’1 min',
      '1 à 2 min',
      '1 à 2 min',
      'plus de 2 min',
    ])
  })

  test('wind: from the drone, DERIVED (an analysis, not a measurement on site)', () => {
    const a = answerFor('vent', { room: null, door: null }, site, engaged)
    expect(a.items[0].status).toBe(engaged.drone.wind.status)
    expect(a.text).toContain('pas une mesure sur site')
  })
})

describe('the panel', () => {
  test('the questions are big buttons that need no server, with Parler, SOS and the copilot state', () => {
    const html = renderToStaticMarkup(createElement(CopilotPanel, { site, snap: engaged }))
    for (const e of CATALOG) expect(html).toContain(e.label)
    expect(html).toContain('Parler')
    expect(html).toContain('SOS')
    expect(html).toContain('Mode règles')
  })
})
