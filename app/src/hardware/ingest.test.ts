// R13: hardware can only aggravate. Whatever the packets do, they never produce an event that lowers a danger, and the labels
// say where each value comes from.

import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { buildSite } from '../site/site'
import { decide, defaultSettings, initialTelemetry, isSilent, reduceTelemetry, scaledStatus, statusOf, type HwOrigin } from './ingest'
import type { HwMessage } from './protocol'

const site = buildSite()
const settings = defaultSettings()
const msg = (sensor: HwMessage['sensor'], value: number, room = 'stockage-solvants'): HwMessage => ({ seq: 1, tMs: 1, source: 'x', sensor, value, unit: '', room })

describe('decide: a packet becomes an event only if it can make things worse', () => {
  test('the defaults are the ones of the configuration', () => {
    expect(settings).toEqual({ triggerThresholdC: v(H.hardware.triggerThresholdC), demoFactor: v(H.hardware.demoFactor) })
    expect(settings.triggerThresholdC).toBe(35)
    expect(settings.demoFactor).toBe(10)
  })

  test('a reading at or above the threshold makes its room critical, and says which', () => {
    const e = decide(msg('temp_bmp280', 35), 'live', settings, site)
    expect(e).toMatchObject({ kind: 'critical-room', valueC: 35, thresholdC: 35, status: 'OBSERVED' })
    expect(site.rooms[(e as { room: number }).room].id).toBe('solvants')
  })

  test('a reading below the threshold is no event at all', () => {
    expect(decide(msg('temp_bmp280', 34.99), 'live', settings, site)).toBeNull()
    expect(decide(msg('temp_bmp280', -10), 'live', settings, site)).toBeNull()
  })

  test('a temperature that falls back produces nothing: there is no event that lowers a danger', () => {
    const events = [24, 48, 52, 40, 30, 22, 19].map((c) => decide(msg('temp_bmp280', c), 'live', settings, site))
    // Only the readings at or above the threshold speak; the cooling ones are silent, never an « all clear ».
    expect(events.map((e) => e !== null)).toEqual([false, true, true, true, false, false, false])
    for (const e of events) if (e) expect(e.kind).toBe('critical-room')
  })

  test('every kind of event is an aggravation: none of them carries a way to clear anything', () => {
    const all = [msg('temp_bmp280', 60), msg('mayday', 1), msg('ari_bar', 100), msg('alt_bmp280', 3), msg('mayday', 0), msg('temp_bmp280', 10)]
    for (const m of all) {
      const e = decide(m, 'live', settings, site)
      if (e) expect(['critical-room', 'mayday', 'ari']).toContain(e.kind)
    }
  })

  test('a mayday of 1 is an event, a mayday of 0 is not', () => {
    expect(decide(msg('mayday', 1, 'binome-1'), 'live', settings, site)).toEqual({ kind: 'mayday', status: 'OBSERVED' })
    expect(decide(msg('mayday', 0, 'binome-1'), 'live', settings, site)).toBeNull()
  })

  test('the air pressure is kept within what a cylinder can read', () => {
    expect(decide(msg('ari_bar', 145, 'binome-1'), 'live', settings, site)).toEqual({ kind: 'ari', bar: 145, status: 'OBSERVED' })
    expect(decide(msg('ari_bar', 999, 'binome-1'), 'live', settings, site)).toMatchObject({ bar: v(H.ari.startBar) })
    expect(decide(msg('ari_bar', -5, 'binome-1'), 'live', settings, site)).toMatchObject({ bar: 0 })
  })

  test('the altitude is shown, never a reason for anything', () => {
    expect(decide(msg('alt_bmp280', 12), 'live', settings, site)).toBeNull()
  })

  test('a room the site does not know is still a danger, for the whole site', () => {
    const e = decide(msg('temp_bmp280', 50, 'cave'), 'live', settings, site)
    expect(e).toMatchObject({ kind: 'critical-room', room: null, roomName: 'cave' })
  })

  test('the threshold of the panel is honoured; a threshold that is not a number triggers nothing, a reading still can', () => {
    expect(decide(msg('temp_bmp280', 40), 'live', { ...settings, triggerThresholdC: 45 }, site)).toBeNull()
    expect(decide(msg('temp_bmp280', 46), 'live', { ...settings, triggerThresholdC: 45 }, site)).not.toBeNull()
    expect(decide(msg('temp_bmp280', 999), 'live', { ...settings, triggerThresholdC: NaN }, site)).toBeNull()
  })
})

describe('labels: where a value comes from (R3)', () => {
  test('live is OBSERVED, a recording is REPLAY, on every event', () => {
    for (const [origin, status] of [['live', 'OBSERVED'], ['replay', 'REPLAY']] as const) {
      expect(statusOf(origin)).toBe(status)
      for (const m of [msg('temp_bmp280', 60), msg('mayday', 1), msg('ari_bar', 100)]) expect(decide(m, origin, settings, site)?.status).toBe(status)
    }
  })

  test('the scaled value is MODELED, never OBSERVED; a replay keeps the weaker label', () => {
    expect(scaledStatus('live')).toBe('MODELED')
    expect(scaledStatus('replay')).toBe('REPLAY')
    expect(scaledStatus('live')).not.toBe('OBSERVED')
  })
})

describe('reduceTelemetry: what the panel shows', () => {
  const feed = (origin: HwOrigin, ...ms: HwMessage[]) => ms.reduce((t, m, i) => reduceTelemetry(t, m, origin, site, 1000 + i * 500), initialTelemetry())

  test('the drone is where its packets say, with its latest readings', () => {
    const t = feed('live', msg('temp_bmp280', 24, 'sas-entree'), msg('alt_bmp280', 0.3, 'sas-entree'), msg('temp_bmp280', 26, 'atelier'))
    expect(t.drone).toMatchObject({ room: 'atelier', tempC: 26, altM: 0.3 })
    expect(site.rooms[t.drone.roomIndex!].id).toBe('halle')
    expect(t.origin).toBe('live')
  })

  test('the air pressure and the mayday of the HUD', () => {
    const t = feed('live', msg('ari_bar', 200, 'binome-1'), msg('mayday', 1, 'binome-1'))
    expect(t.hud).toMatchObject({ ariBar: 200, mayday: true })
  })

  test('a mayday stays on when later packets say 0: only the COS clears it', () => {
    const t = feed('live', msg('mayday', 1, 'binome-1'), msg('mayday', 0, 'binome-1'), msg('ari_bar', 150, 'binome-1'))
    expect(t.hud.mayday).toBe(true)
  })

  test('a recording is shown as a replay', () => {
    expect(feed('replay', msg('temp_bmp280', 30)).origin).toBe('replay')
  })

  test('a device that stops talking is shown as silent, with the last value kept, never an all clear', () => {
    const t = feed('live', msg('temp_bmp280', 48))
    expect(isSilent(t.drone.lastAtMs, t.drone.lastAtMs! + v(H.hardware.staleAfterS) * 1000)).toBe(false)
    expect(isSilent(t.drone.lastAtMs, t.drone.lastAtMs! + v(H.hardware.staleAfterS) * 1000 + 1)).toBe(true)
    expect(isSilent(null, 99999)).toBe(false)
    expect(t.drone.tempC).toBe(48)
  })
})
