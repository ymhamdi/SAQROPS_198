// The video scenario replayed with the v4 model (ml/model-v4, trained on real UL FSRI experiments only), without touching
// the shipped model or demo.test.ts. A report, not a gate: it prints what happens at each step of the script (CLAUDE.md §9)
// with the exported thresholds and with the secondary per-run thresholds (ml/report/v4-real/comparison.md), and only
// checks that the replay ran. Skipped when ml/model-v4 is absent.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { makePredictor } from '../ml/predict'
import { parseXgb } from '../ml/xgb'
import { buildSite } from '../site/site'
import { engage, initSim, launchDrone, makeContext, reengageTeam, setObjectives, startFire, teamNow, tick, toggleDoor } from './sim'

const DIR = new URL('../../../ml/model-v4/', import.meta.url)
const HAS_V4 = existsSync(new URL('metrics.json', DIR))
const read = (f: string) => JSON.parse(readFileSync(new URL(f, DIR), 'utf-8'))

function predictor(which: 'exported' | 'secondary') {
  const metrics = read('metrics.json')
  const thresholds = which === 'exported' ? metrics.thresholds : metrics.secondaryThresholdsPerRun
  return makePredictor({ p30: parseXgb(read('model-30s.json')), p60: parseXgb(read('model-60s.json')), tff: parseXgb(read('model-tff.json')) }, { ...metrics, thresholds })
}

function replay(which: 'exported' | 'secondary'): string[] {
  const log: string[] = [`v4, ${which} thresholds ${JSON.stringify(predictor(which).thresholds)}`]
  // A. Door left open all along: does the booth get a NO-GO, and how long before its real flashover?
  {
    const site = buildSite()
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), predictor(which))
    const s = initSim(ctx, initialDoors(site), 42)
    const booth = site.rooms.findIndex((r) => r.id === 'peinture')
    startFire(ctx, s, site.demo.fireAt)
    let firstNoGo: number | null = null
    let out: string | null = null
    for (let k = 0; k < 600; k++) {
      if (k === 100) {
        engage(ctx, s)
        log.push(`A t=${s.fire.t} engaged: ${s.shown.verdict}${s.shown.verdict === 'NO-GO' ? ' — ' + s.shown.reasons.filter((r) => r.severity === 'no-go').map((r) => r.message).join(' | ') : ''}`)
      }
      tick(ctx, s)
      if (firstNoGo === null && s.shown.verdict === 'NO-GO' && k >= 100) {
        firstNoGo = s.fire.t
        log.push(`A t=${s.fire.t} first NO-GO after engagement: ${s.shown.reasons.filter((r) => r.severity === 'no-go').map((r) => r.message).join(' | ')}`)
      }
      if (out === null && s.team.mode === 'out') out = `A t=${s.fire.t} team out at ${teamNow(ctx, s).bar.toFixed(0)} bar (whistle ${ctx.air.whistleBar})`
    }
    const fo = s.fire.rooms[booth].flashedAt
    const alert = s.firstAlertAt[booth]
    log.push(out ?? `A team not out by t=${s.fire.t} (mode ${s.team.mode}, ${teamNow(ctx, s).bar.toFixed(0)} bar)`)
    log.push(`A booth: first AI alert ${alert}, real flashover ${fo}, lead ${alert !== null && fo !== null ? fo - alert + ' s' : '—'}`)
  }
  // B. The whole video script, step by step, nothing asserted.
  {
    const site = buildSite()
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), predictor(which))
    const s = initSim(ctx, initialDoors(site), 42)
    const booth = site.rooms.findIndex((r) => r.id === 'peinture')
    const door = site.doors.findIndex((d) => d.id === 'd-solvants-peinture')
    const run = (until: (x: typeof s) => boolean, max = 600) => {
      for (let k = 0; k < max && !until(s); k++) tick(ctx, s)
    }
    startFire(ctx, s, site.demo.fireAt)
    run((x) => x.fire.t >= 60)
    launchDrone(ctx, s)
    log.push(`B t=${s.fire.t} drone ${s.drone.status}`)
    run((x) => x.fire.t >= 100)
    engage(ctx, s)
    log.push(`B t=${s.fire.t} engaged: ${s.shown.verdict}, exit planned at ${teamNow(ctx, s).exitBar?.toFixed(0)} bar`)
    run((x) => x.latch.latched)
    const boothNoGo = s.shown.reasons.some((r) => r.code === 'FLASHOVER_PREDICTED' && r.severity === 'no-go' && r.message.includes('peinture'))
    log.push(`B t=${s.fire.t} latched ${s.latch.latched}: ${s.shown.reasons.filter((r) => r.severity === 'no-go').map((r) => r.message).join(' | ') || 'no NO-GO reason'}; booth flashover predicted: ${boothNoGo}; team ${s.team.mode}, exit at ${teamNow(ctx, s).exitBar?.toFixed(0)} bar`)
    const before = s.predictions.find((p) => p.room === booth)
    toggleDoor(ctx, s, door)
    run(() => false, 15)
    const after = s.predictions.find((p) => p.room === booth)
    log.push(`B t=${s.fire.t} door closed: booth P60 ${before?.p60.toFixed(2)} → ${after?.p60.toFixed(2)}, estimate ${before?.tffS.toFixed(0)} → ${after?.tffS.toFixed(0)} s; verdict ${s.shown.verdict}`)
    run((x) => x.team.mode === 'out')
    log.push(`B t=${s.fire.t} team ${s.team.mode} at ${teamNow(ctx, s).bar.toFixed(0)} bar`)
    setObjectives(ctx, s, ['coupure-tgbt'], 'Objectif cabine retiré par le PC')
    reengageTeam(ctx, s)
    log.push(`B t=${s.fire.t} re-engaged to the switchboard: ${s.shown.verdict}${s.shown.verdict === 'NO-GO' ? ' — ' + s.shown.reasons.filter((r) => r.severity === 'no-go').map((r) => r.message).join(' | ') : ''}, exit planned at ${teamNow(ctx, s).exitBar?.toFixed(0)} bar`)
  }
  return log
}

describe.skipIf(!HAS_V4)('video scenario replayed with the v4 model (report only)', { timeout: 120_000 }, () => {
  for (const which of ['exported', 'secondary'] as const) {
    test(`${which} thresholds`, () => {
      const log = replay(which)
      console.log(log.join('\n'))
      expect(log.length).toBeGreaterThan(5)
    })
  }
})
