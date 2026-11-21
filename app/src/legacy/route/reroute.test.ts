import { describe, expect, test } from 'vitest'
import { routeStats } from '../stats/stats'
import { gridFrom, idx } from '../testing/grids'
import { DEFAULT_ROUTE_PARAMS, prepareGrid, ROVER_ROUTE_PARAMS } from './cost'
import { joinRoute, splitAt } from './reroute'
import { planRide, planRoute } from './route'
import { walkHomeField } from './search'

// 600 m of flat ground: habitat at column 0, stops at 120 m and 300 m.
const g = gridFrom(Array.from({ length: 9 }, () => '.'.repeat(300)))
const walk = prepareGrid(g, DEFAULT_ROUTE_PARAMS)
const base = idx(g, 4, 0)
const cells = [base, idx(g, 4, 60), idx(g, 4, 150), base]
const DWELL = 20 * 60
const plan = planRoute(walk, cells)
if (!plan.ok) throw new Error('no route')
const stats = routeStats(walk, plan.legs, [DWELL, DWELL])
const track = stats.track
/** first track index on leg `leg` that is not a stop */
const midOf = (leg: number) => track.findIndex((p, i) => p.leg === leg && i > 0 && track[i - 1].leg === leg) + 20

describe('cutting the plan where the crew is', () => {
  test('mid-leg: the walked legs are kept, the current leg is cut a few cells ahead of the crew', () => {
    const i = midOf(1)
    const s = splitAt(plan, track, { index: i, atStop: false }, 5)
    expect(s.kind).toBe('split')
    if (s.kind !== 'split') return
    expect(s.kept).toBe(1) // stop 0 reached; the stop being walked to can be changed
    expect(s.prefix[0]).toBe(plan.legs[0])
    expect(s.fromCell).toBe(track[i + 6].cell)
    expect(s.reroute).toBe(s.fromCell)
    expect(plan.legs[1].cells.slice(0, s.prefix[1].cells.length)).toEqual(s.prefix[1].cells)
  })

  test('the clock does not move: after the cut the new plan reaches the cut at the same time', () => {
    const i = midOf(1)
    const s = splitAt(plan, track, { index: i, atStop: false }, 5)
    if (s.kind !== 'split') throw new Error('no split')
    // New rest: straight home from the cut (stop 1 dropped). The cut is a via point with no dwell.
    const rest = planRoute(walk, [s.fromCell, base])
    if (!rest.ok) throw new Error('no rest')
    const joined = joinRoute(s, rest, base, false)
    expect(joined.legs).toHaveLength(3) // stop 0, the route-change point, home
    const after = routeStats(walk, joined.legs, [DWELL, 0])
    const cut = after.track.findIndex((p) => p.cell === s.fromCell)
    expect(after.track[cut].arriveS).toBeCloseTo(track[i + 6].arriveS, 6)
    expect(after.track[cut].departS).toBe(after.track[cut].arriveS)
    expect(after.totalS).toBeLessThan(stats.totalS)
  })

  test('at a stop the stop stays; before the start everything can change; nearly home nothing can', () => {
    const atS0 = track.findIndex((p) => p.departS > p.arriveS)
    const s = splitAt(plan, track, { index: atS0, atStop: true })
    expect(s.kind === 'split' && [s.kept, s.reroute, s.fromCell]).toEqual([1, null, cells[1]])
    const start = splitAt(plan, track, { index: 0, atStop: false })
    expect(start.kind === 'split' && [start.kept, start.prefix.length, start.fromCell]).toEqual([0, 0, base])
    expect(splitAt(plan, track, { index: track.length - 1, atStop: true }).kind).toBe('done')
    expect(splitAt(plan, track, { index: track.length - 2, atStop: false }, 5).kind).toBe('done')
  })

  test('arriving at a stop within the lead: the cut is that stop', () => {
    const arrive = track.findIndex((p) => p.departS > p.arriveS)
    const s = splitAt(plan, track, { index: arrive - 2, atStop: false }, 5)
    expect(s.kind === 'split' && [s.kept, s.reroute]).toEqual([1, null])
  })
})

describe('rover-assisted plan', () => {
  const drive = prepareGrid(g, ROVER_ROUTE_PARAMS)
  const reach = walkHomeField(drive, base)
  const ride = planRide(walk, drive, reach, cells, 400, 120)
  if (!ride.ok) throw new Error('no ride')
  const rs = routeStats(walk, ride.legs, [DWELL, DWELL], drive)

  test('the rest starts with the rover where it is, and the clock does not move at the cut', () => {
    const i = rs.track.findIndex((p, k) => k > 5 && p.leg === 1 && !rs.track[k + 12]?.riding === !p.riding)
    const s = splitAt(ride, rs.track, { index: i, atStop: false }, 5)
    if (s.kind !== 'split') throw new Error('no split')
    const j = rs.track.findIndex((p) => p.cell === s.fromCell)
    expect(s.roverStart).toBe(rs.track[j].riding ? s.fromCell : rs.track[j].roverCell)
    const rest = planRide(walk, drive, reach, [s.fromCell, base], 400, 120, s.roverStart)
    if (!rest.ok) throw new Error('no rest')
    const joined = joinRoute(s, rest, base, true)
    expect(joined.ride?.parked).toBeDefined()
    const after = routeStats(walk, joined.legs, [DWELL, 0], drive)
    expect(after.track[after.track.findIndex((p) => p.cell === s.fromCell)].arriveS).toBeCloseTo(rs.track[j].arriveS, 6)
    expect(after.track.at(-1)!.cell).toBe(base)
  })
})
