// The twin's window: it renders from a snapshot, carries « Décision : COS » (R2) and a label on every number (R3), and
// says plainly when the AI is the one that turned a GO into a NO-GO (R1). Fixture model: ml/model-v1, which alerts on the
// paint booth in the video scenario; the shipped v4 does not on our simulated readings, so it cannot exercise that display.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictorFrom } from '../ml/loadModelDir.node'
import { snapshot } from '../sim/protocol'
import { engage, initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { aiWorsened } from './history'
import { Twin } from './Twin'

// The plans build a canvas ImageData while rendering; Node has none, so give it a stand-in that only stores pixels.
class ImageDataStub {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}
Object.assign(globalThis, { ImageData: ImageDataStub })

describe('the digital twin window', { timeout: 120_000 }, () => {
  const site = buildSite()
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictorFrom('model-v1'))
  const s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  // Run to the moment the AI, alone, turns the verdict to NO-GO (the booth is flagged before its detectors fail).
  let aiOnly = snapshot(ctx, s)
  for (let k = 0; k < 400; k++) {
    if (k === 100) engage(ctx, s)
    tick(ctx, s)
    aiOnly = snapshot(ctx, s)
    if (aiWorsened(aiOnly)) break
  }
  const html = renderToStaticMarkup(createElement(Twin, { site, snap: aiOnly }))

  test('waits for the PC when it has nothing to show yet', () => {
    const empty = renderToStaticMarkup(createElement(Twin, { site, snap: null }))
    expect(empty).toContain('En attente du PC du COS')
  })

  test('shows reality and the twin side by side, the chain, and the four curves', () => {
    expect(aiWorsened(aiOnly)).toBe(true)
    for (const text of ['Monde réel', 'Jumeau numérique', 'Chaîne de décision en direct', 'Fusion (R1)', 'Température : réalité et capteurs', 'IA : probabilité d’embrasement', 'Délai avant l’embrasement', 'Air du binôme et sifflet']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('13 variables')
  })

  test('R1: it says when the AI is what turned GO into NO-GO', () => {
    expect(html).toContain('L’IA a aggravé le verdict')
  })

  test('R2: the verdict carries « Décision : COS »', () => {
    expect(html).toContain('NO-GO')
    expect(html).toContain('Décision : COS')
  })

  test('R3: the reality is labelled SIMULATED and nothing in the demo claims to be OBSERVED', () => {
    expect(html).toContain('badge-simulated')
    expect(html).not.toContain('badge-observed')
  })

  test('every number it shows through the number component carries a badge', () => {
    // Each <strong> of a .num is followed by a badge inside the same span.
    const nums = html.match(/<span class="num">.*?<\/span><\/span>|<span class="num">.*?<\/span>/g) ?? []
    expect(nums.length).toBeGreaterThan(20)
    for (const n of nums) expect(n).toContain('class="badge badge-')
  })
})
