// The reflex instructions are a sourced table (never generated at run time), each to be validated by the Protection civile.

import { describe, expect, test } from 'vitest'
import consignes from '../../../data/consignes.json' with { type: 'json' }
import { buildSite } from '../site/site'
import { hazardsFor } from './Card'

describe('data/consignes.json', () => {
  test('covers the hazards of the brief: electrical, gas/BLEVE, solvents, Li-ion, water-reactive, toxic smoke', () => {
    for (const k of ['electrique', 'gaz', 'solvants', 'liion', 'eau', 'fumees']) expect(Object.keys(consignes.hazards)).toContain(k)
  })

  test('every instruction has a text and a source; the table says it must be validated', () => {
    expect(consignes.validation).toBe('à valider par la Protection civile')
    for (const h of Object.values(consignes.hazards)) {
      expect(h.items.length).toBeGreaterThan(0)
      for (const it of h.items) {
        expect(it.text.length).toBeGreaterThan(20)
        expect(it.source.length).toBeGreaterThan(5)
      }
    }
  })

  test('every hazard named on the site plan has instructions', () => {
    const site = buildSite()
    const named = new Set([...site.rooms.flatMap((r) => r.hazards), ...site.obstacles.flatMap((o) => o.hazards)])
    for (const h of named) expect(Object.keys(consignes.hazards), h).toContain(h)
  })

  test('a route through the paint booth carries the solvent instructions', () => {
    const site = buildSite()
    const booth = site.rooms.find((r) => r.id === 'peinture')!
    const { onRoute } = hazardsFor(site, booth.cells.slice(0, 5))
    expect(onRoute).toContain('solvants')
  })
})
