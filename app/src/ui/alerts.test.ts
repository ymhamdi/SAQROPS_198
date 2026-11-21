import { describe, expect, test } from 'vitest'
import type { Reason } from '../stats/goNoGo'
import type { LiveWarning } from '../stats/live'
import { takesOver, walkAlerts } from './alerts'

const N = { marginS: 45 * 60, o2LeftS: 2 * 3600 }
const live = (code: LiveWarning['code'], severity: LiveWarning['severity'], message: string = code): LiveWarning => ({ code, severity, message })
const plan = (code: Reason['code'], severity: Reason['severity'], message: string = code): Reason => ({ code, severity, message })

describe('walkAlerts', () => {
  test('ranks live warnings, then plan no-go, then live cautions, then plan cautions', () => {
    const a = walkAlerts(
      [live('MARGIN_LOW', 'caution'), live('NO_RETURN', 'no-go')],
      [plan('STEEP_SECTIONS', 'caution'), plan('SUNSET', 'no-go'), plan('DOSE', 'info')],
      N,
    )
    expect(a.map((x) => x.key)).toEqual(['live-NO_RETURN', 'plan-SUNSET', 'live-MARGIN_LOW', 'plan-STEEP_SECTIONS'])
    expect(takesOver(a)).toBe(true)
    expect(a[0]).toMatchObject({ level: 'warning', title: 'Past the point of no return', action: 'Turn back now' })
  })

  test('a plan reason a live alert already covers is not shown twice', () => {
    const a = walkAlerts([live('RADIATION_NOW', 'no-go')], [plan('RADIATION', 'no-go')], N, true)
    expect(a.map((x) => x.key)).toEqual(['live-RADIATION_NOW'])
    expect(a[0]).toMatchObject({ drill: true, action: 'Take shelter now' })
  })

  test('a plan no-go is a warning line, not a takeover; cautions carry their number', () => {
    const a = walkAlerts([live('MARGIN_LOW', 'caution')], [plan('POINT_OF_NO_RETURN', 'no-go', 'Point of no return passed 7.5 km into the route')], N)
    expect(takesOver(a)).toBe(false)
    expect(a[0]).toMatchObject({ level: 'warning', live: false, title: 'Plan passes the point of no return', detail: 'Point of no return passed 7.5 km into the route' })
    expect(a[1].title).toBe('Point of no return in 45 min')
  })

  test('the drill tag only marks radiation, and only when the drill is on', () => {
    expect(walkAlerts([], [plan('RADIATION', 'no-go')], N, true)[0].drill).toBe(true)
    expect(walkAlerts([], [plan('RADIATION', 'no-go')], N, false)[0].drill).toBe(false)
    expect(walkAlerts([], [plan('SAND', 'caution')], N, true)[0].drill).toBe(false)
  })

  test('nothing to show', () => {
    expect(walkAlerts([], [plan('DOSE', 'info')], N)).toEqual([])
    expect(takesOver([])).toBe(false)
  })
})
