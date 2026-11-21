// R3: every number shown carries its label; nothing SIMULATED or MOCK looks like OBSERVED.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import type { Predictor } from '../ml/predict'
import { snapshot } from '../sim/protocol'
import { engage, initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { DATA_STATUSES } from '../types'
import { Num } from './Num'
import { StatusBadge } from './StatusBadge'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('R3 labels', () => {
  test('each status has its own badge style; SIMULATED and MOCK never use the OBSERVED one', () => {
    const classes = DATA_STATUSES.map((s) => html(createElement(StatusBadge, { status: s })).match(/class="([^"]+)"/)![1])
    expect(new Set(classes).size).toBe(DATA_STATUSES.length)
    for (const s of ['SIMULATED', 'MOCK'] as const) expect(html(createElement(StatusBadge, { status: s }))).not.toContain('badge-observed')
  })

  test('a number always renders with its badge, even when missing', () => {
    for (const value of [12.3, null, NaN]) {
      const out = html(createElement(Num, { value, unit: 'bar', status: 'SIMULATED' }))
      expect(out).toContain('badge-simulated')
      expect(out).toContain('bar')
    }
  })

  test('in the demo, readings, predictions and live air are SIMULATED, never OBSERVED', () => {
    const site = buildSite()
    const stub: Predictor = { predict: () => ({ p30: 0, p60: 0, tffS: 300 }), thresholds: { p30: 0.5, p60: 0.5 }, dummy: false, trainedOn: 'stub' }
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), stub)
    const s = initSim(ctx, initialDoors(site), 1)
    startFire(ctx, s, site.demo.fireAt)
    engage(ctx, s)
    for (let k = 0; k < 30; k++) tick(ctx, s)
    const snap = snapshot(ctx, s)
    expect(snap.readingsStatus).toBe('SIMULATED')
    for (const r of snap.rooms) {
      expect(r.status).toBe('SIMULATED')
      if (r.pred) expect(r.pred.status).toBe('SIMULATED')
    }
    for (const reason of snap.shown.reasons) expect(reason.status).not.toBe('OBSERVED')
  })
})
