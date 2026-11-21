// The wire format: the exact lines of the specification parse, and nothing the USB link can throw at us crashes the app.

import { describe, expect, test } from 'vitest'
import { buildSite } from '../site/site'
import { alertLine, LineBuffer, parseLine, roomIndexOf } from './protocol'

const site = buildSite()

describe('parseLine: the packets of the two devices', () => {
  test('drone payload: temperature and barometric altitude, exactly as the firmware sends them', () => {
    const t = parseLine('{"seq": 42, "t_ms": 183500, "source": "drone-payload", "sensor": "temp_bmp280", "value": 54.20, "unit": "C", "room": "stockage-solvants"}')
    expect(t).toEqual({ seq: 42, tMs: 183500, source: 'drone-payload', sensor: 'temp_bmp280', value: 54.2, unit: 'C', room: 'stockage-solvants' })
    const a = parseLine('{"seq": 43, "t_ms": 183500, "source": "drone-payload", "sensor": "alt_bmp280", "value": 0.35, "unit": "m", "room": "stockage-solvants"}')
    expect(a).toMatchObject({ sensor: 'alt_bmp280', value: 0.35, unit: 'm' })
  })

  test('binôme HUD: air pressure and the mayday', () => {
    expect(parseLine('{"seq": 101, "t_ms": 184000, "source": "binome-hud", "sensor": "ari_bar", "value": 145.0, "unit": "bar", "room": "binome-1"}')).toMatchObject({ sensor: 'ari_bar', value: 145 })
    expect(parseLine('{"seq": 102, "t_ms": 184120, "source": "binome-hud", "sensor": "mayday", "value": 1, "unit": "bool", "room": "binome-1"}')).toMatchObject({ sensor: 'mayday', value: 1 })
  })

  test('a mayday sent as a boolean is understood too', () => {
    expect(parseLine('{"sensor":"mayday","value":true}')?.value).toBe(1)
    expect(parseLine('{"sensor":"mayday","value":false}')?.value).toBe(0)
  })

  test('boot banners, empty lines, half lines and bad JSON are ignored, never thrown', () => {
    for (const junk of ['', '   ', 'ets Jul 29 2019 12:21:46', 'rst:0x1 (POWERON_RESET)', '{"seq": 42, "t_ms": 18', '{not json}', '[1,2,3]', 'null', '"text"', '{"sensor":"temp_bmp280"}']) {
      expect(() => parseLine(junk)).not.toThrow()
      expect(parseLine(junk), junk).toBeNull()
    }
  })

  test('an unknown sensor, a value that is not a finite number: ignored', () => {
    expect(parseLine('{"sensor":"gps","value":1}')).toBeNull()
    expect(parseLine('{"sensor":"temp_bmp280","value":"hot"}')).toBeNull()
    expect(parseLine('{"sensor":"temp_bmp280","value":null}')).toBeNull()
    expect(parseLine('{"sensor":"temp_bmp280","value":1e999}')).toBeNull()
  })

  test('a very long line is noise', () => {
    expect(parseLine(`{"sensor":"temp_bmp280","value":1,"room":"${'x'.repeat(5000)}"}`)).toBeNull()
  })
})

describe('LineBuffer: a chunk can stop in the middle of a packet', () => {
  test('lines are returned once complete, and CRLF is tolerated', () => {
    const b = new LineBuffer()
    expect(b.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(b.push(':2}\r\n{"c":3}')).toEqual(['{"b":2}'])
    expect(b.push('\n')).toEqual(['{"c":3}'])
  })

  test('a packet cut at every possible byte comes out whole', () => {
    const line = '{"seq":1,"t_ms":2,"source":"drone-payload","sensor":"temp_bmp280","value":24.5,"unit":"C","room":"atelier"}'
    for (let cut = 1; cut < line.length; cut++) {
      const b = new LineBuffer()
      const out = [...b.push(line.slice(0, cut)), ...b.push(`${line.slice(cut)}\n`)]
      expect(out).toEqual([line])
      expect(parseLine(out[0])?.value).toBe(24.5)
    }
  })

  test('garbage with no newline does not grow without bound, and the next packet still gets through', () => {
    const b = new LineBuffer()
    for (let i = 0; i < 50; i++) b.push('x'.repeat(500))
    expect(b.push('\n{"sensor":"ari_bar","value":200}\n').map(parseLine).filter(Boolean)).toHaveLength(1)
  })
})

describe('the line sent to the HUD', () => {
  test('exactly the command of the specification, newline-terminated', () => {
    expect(alertLine('NO-GO')).toBe('{"cmd":"alert","level":"NO-GO"}\n')
    expect(alertLine('GO')).toBe('{"cmd":"alert","level":"GO"}\n')
  })
})

describe('the rooms the firmware names', () => {
  test('each maps to a room of the demo site', () => {
    expect(site.rooms[roomIndexOf(site, 'stockage-solvants')!].id).toBe('solvants')
    expect(site.rooms[roomIndexOf(site, 'atelier')!].id).toBe('halle')
    expect(site.rooms[roomIndexOf(site, 'sas-entree')!].id).toBe('halle')
  })

  test('a room id of the app is accepted as it is, an unknown name is null', () => {
    expect(site.rooms[roomIndexOf(site, 'peinture')!].id).toBe('peinture')
    expect(roomIndexOf(site, 'cave')).toBeNull()
  })
})
