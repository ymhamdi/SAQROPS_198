// The validated plan reaches the tablet and the printed reflex card (R12: labelled and framed, only once validated; R2: with
// « Décision : COS »; R3: every number labelled). The live HUD never shows it.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { REHEARSAL_BANNER } from '../rehearsal/RehearsalBanner'
import { rehearse } from '../rehearsal/engine'
import { knownInputOf } from '../rehearsal/input'
import { applyAction } from '../sim/actions'
import { snapshot, type Snapshot } from '../sim/protocol'
import { initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { Card } from './Card'
import { Hud } from './Hud'
import { Tablet } from './Tablet'

const site = buildSite()
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
let waiting: Snapshot
let validated: Snapshot

beforeAll(() => {
  // Node has no ImageData, which the plan drawing creates while rendering.
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
        if (typeof a === 'number') {
          this.width = a
          this.height = b
          this.data = new Uint8ClampedArray(a * b * 4)
        } else {
          this.data = a
          this.width = b
          this.height = c!
        }
      }
    },
  )
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  for (let k = 0; k < 90; k++) {
    if (k === 25) applyAction(ctx, s, { type: 'indoor' })
    tick(ctx, s)
  }
  waiting = structuredClone(snapshot(ctx, s))
  applyAction(ctx, s, { type: 'plan-validate', plan: rehearse(site, knownInputOf(site, snapshot(ctx, s))) })
  for (let k = 0; k < 10; k++) tick(ctx, s)
  validated = structuredClone(snapshot(ctx, s))
}, 60_000)

afterAll(() => vi.unstubAllGlobals())

describe('the validated plan on the tablet and the card', () => {
  test('the tablet shows it, framed as a rehearsal, with the hours, the turn-back time and the fall-back exit', () => {
    const out = html(createElement(Tablet, { site, snap: validated }))
    expect(out).toContain('Plan validé par le COS')
    expect(out).toContain(REHEARSAL_BANNER)
    expect(out).toContain('rehearsal-frame')
    expect(out).toContain('Demi-tour au plus tard')
    expect(out).toContain('Sortie de repli')
    expect(out).toContain('Décision : COS')
    expect(out).toMatch(/badge-(simulated|modeled)/)
  })

  test('the card prints it as a section « Plan validé », framed, with « Décision : COS »', () => {
    const out = html(createElement(Card, { site, snap: validated, onClose: () => {} }))
    expect(out).toContain('Plan validé')
    expect(out).toContain(REHEARSAL_BANNER)
    expect(out).toContain('Demi-tour au plus tard')
    expect(out).toContain('Décision : COS')
  })

  test('before the COS validates, neither shows it (the rehearsal does not apply yet)', () => {
    expect(waiting.plan).toBeNull()
    for (const out of [html(createElement(Tablet, { site, snap: waiting })), html(createElement(Card, { site, snap: waiting, onClose: () => {} }))]) {
      expect(out).not.toContain(REHEARSAL_BANNER)
      expect(out).not.toContain('Plan validé')
      expect(out).not.toContain('rehearsal-frame')
    }
  })

  test('the live HUD never shows it, validated or not', () => {
    const out = html(createElement(Hud, { site, snap: validated }))
    expect(out).not.toContain(REHEARSAL_BANNER)
    expect(out).not.toMatch(/Plan validé|Demi-tour|rehearsal/i)
  })
})
