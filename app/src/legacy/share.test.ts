import { describe, expect, test } from 'vitest'
import { decodePlan, encodePlan, type SharedPlan } from './share'
import type { ScienceTarget, Waypoint } from './types'

const target = (id: string, lat: number, lon: number): ScienceTarget => ({
  id,
  lat,
  lon,
  name: `Target ${id}`,
  why: '',
  instrumentsNeeded: [],
  source: 'test',
  status: 'MOCK',
})
const targets = [target('ridge-a', -4.7, 137.38), target('vein:b', -4.71, 137.39)]
const sci = (t: ScienceTarget): Waypoint => ({ id: t.id, lat: t.lat, lon: t.lon, kind: 'science', name: t.name })
const ok = () => null

const plan: SharedPlan = {
  stops: [sci(targets[0]), { id: 'via-7', lat: -4.7051234567, lon: 137.3851234567, kind: 'via', name: 'Via point 7' }, sci(targets[1])],
  startTime: '2026-11-15T10:25:03.000Z',
  roverAt: 'via-7',
  profile: 'fastest',
  storm: true,
}

describe('plan link', () => {
  test('round-trips stops, start, rover, route and storm', () => {
    const hash = encodePlan(plan)
    expect(hash).toBe('#stops=t:ridge-a,v:-4.705123:137.385123,t:vein%3Ab&start=2026-11-15T10:25:03.000Z&rover=2&route=fastest&storm=1')
    const back = decodePlan(hash, targets, ok)!
    expect(back.skipped).toEqual([])
    expect(back.stops.map((s) => s.id)).toEqual(['ridge-a', 'via-1', 'vein:b'])
    expect(back.stops[1]).toMatchObject({ kind: 'via', name: 'Via point 1', lat: -4.705123, lon: 137.385123 })
    expect(back).toMatchObject({ startTime: plan.startTime, roverAt: 'via-1', profile: 'fastest', storm: true })
  })

  test('priorities: one letter per stop, only when one is not medium; they follow their stops', () => {
    expect(encodePlan({ ...plan, priorities: { 'ridge-a': 'medium' } })).not.toContain('prio=')
    const hash = encodePlan({ ...plan, priorities: { 'ridge-a': 'high', 'vein:b': 'low' } })
    expect(hash).toContain('&prio=hml')
    const back = decodePlan(hash, targets, ok)!
    expect(back.priorities).toEqual({ 'ridge-a': 'high', 'vein:b': 'low' }) // medium is the default, not stored
    // a stop that is not restored takes its letter with it
    const skipped = decodePlan('#stops=t:gone,t:vein%3Ab&prio=hl', targets, ok)!
    expect(skipped.priorities).toEqual({ 'vein:b': 'low' })
  })

  test('an empty plan with defaults has no hash, and no hash means no plan', () => {
    expect(encodePlan({ stops: [], startTime: null, roverAt: 'habitat', profile: 'safest', storm: false })).toBe('')
    expect(decodePlan('', targets, ok)).toBeNull()
    expect(decodePlan('#section-2', targets, ok)).toBeNull()
  })

  test('unknown targets, unreadable tokens and rejected stops are skipped with reasons; the rover follows its stop', () => {
    const tooFar = (w: Waypoint) => (w.lat < -5 ? 'outside the mapped site.' : null)
    const back = decodePlan('#stops=t:nope,v:-6:137.4,v:x:1,t:ridge-a,v:-4.7:137.38,t:ridge-a&rover=5&start=soon', targets, tooFar)!
    expect(back.stops.map((s) => s.id)).toEqual(['ridge-a', 'via-1'])
    expect(back.roverAt).toBe('via-1')
    expect(back.startTime).toBeNull()
    expect(back.skipped).toEqual([
      'Stop 1: no science target "nope" at this site.',
      'Stop 2 (Via point 1): outside the mapped site.',
      'Stop 3: unreadable in the link.',
      'The start time in the link is unreadable: the default start is used.',
    ])
  })

  test('a rover staged at a skipped stop goes back to the habitat', () => {
    const back = decodePlan('#stops=t:gone,t:ridge-a&rover=1', targets, ok)!
    expect(back.roverAt).toBe('habitat')
    expect(back.skipped).toHaveLength(2)
  })
})
