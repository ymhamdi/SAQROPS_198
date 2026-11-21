// The firmware and the app must agree on the wire. The sketches cannot be compiled here, so these tests read them and hold
// them to the protocol of protocol.ts and the configuration: same baud rate, same sensors, same rooms, same cadence, the same
// pins as the wiring, and the JSON they print parses with the app's own parser.

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { parseLine } from './protocol'

const read = (p: string) => readFileSync(new URL(`../../../firmware/${p}`, import.meta.url), 'utf-8')
const drone = read('drone_payload/drone_payload.ino')
const hud = read('binome_hud/binome_hud.ino')
const readme = read('README.md')

/** The wire format a sketch prints, with its placeholders filled in, as the app would receive it. */
function printed(source: string, fill: Record<string, string>): string {
  const literal = /"(\{\\"seq\\".*?\}\\n)"/.exec(source)
  if (!literal) throw new Error('no packet format found')
  let text = literal[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  const order = [...text.matchAll(/%\.?\d*[a-z]+/g)].map((m) => m[0])
  order.forEach((spec, i) => (text = text.replace(spec, fill[String(i)] ?? '0')))
  return text
}

describe('the drone payload sketch', () => {
  test('speaks the configured baud rate and the cadence of the configuration', () => {
    expect(drone).toMatch(new RegExp(`BAUD = ${v(H.hardware.baudRate)}\\b`))
    expect(drone).toMatch(new RegExp(`LOOP_MS = ${v(H.hardware.droneIntervalMs)}\\b`))
  })

  test('is wired as documented: BMP280 on SDA 21 / SCL 22, the microswitch on GPIO 4 with the pull-up, 0x76 then 0x77', () => {
    expect(drone).toMatch(/PIN_SDA = 21/)
    expect(drone).toMatch(/PIN_SCL = 22/)
    expect(drone).toMatch(/PIN_SWITCH = 4/)
    expect(drone).toContain('INPUT_PULLUP')
    expect(drone).toContain('bmp.begin(0x76)')
    expect(drone).toContain('bmp.begin(0x77)')
    expect(drone).toMatch(/DEBOUNCE_MS = 200/)
  })

  test('names the three rooms the app maps, in the order the switch cycles them', () => {
    const m = /ROOMS\[\] = \{([^}]*)\}/.exec(drone)!
    expect(m[1].match(/"([^"]+)"/g)!.map((s) => s.replace(/"/g, ''))).toEqual(['sas-entree', 'atelier', 'stockage-solvants'])
  })

  test('sends the two sensors of the specification, and the line it prints parses with the app’s own parser', () => {
    expect(drone).toContain('"temp_bmp280"')
    expect(drone).toContain('"alt_bmp280"')
    const line = printed(drone, { '0': '42', '1': '183500', '2': 'temp_bmp280', '3': '54.20', '4': 'C', '5': 'stockage-solvants' })
    expect(line.endsWith('\n')).toBe(true)
    expect(parseLine(line)).toEqual({ seq: 42, tMs: 183500, source: 'drone-payload', sensor: 'temp_bmp280', value: 54.2, unit: 'C', room: 'stockage-solvants' })
  })

  test('takes a base pressure at start-up for the relative altitude, and never invents a reading', () => {
    expect(drone).toContain('basePressureHpa = bmp.readPressure() / 100.0F')
    expect(drone).toContain('readAltitude(basePressureHpa)')
    expect(drone).toContain('isnan(value)')
    expect(drone).not.toMatch(/random\s*\(/)
  })
})

describe('the binôme HUD sketch', () => {
  test('speaks the configured baud rate and the cadence of the configuration', () => {
    expect(hud).toMatch(new RegExp(`BAUD = ${v(H.hardware.baudRate)}\\b`))
    expect(hud).toMatch(new RegExp(`ARI_MS = ${v(H.hardware.hudIntervalMs)}\\b`))
  })

  test('is wired as documented: wiper on PA0, the IR sensor on PA1 (active low), the screen on 0x27 then 0x3F, optional', () => {
    expect(hud).toMatch(/define PIN_ARI PA0/)
    expect(hud).toMatch(/define PIN_MAYDAY PA1/)
    expect(hud).toContain('== LOW')
    expect(hud).toContain('present(0x27)')
    expect(hud).toContain('present(0x3F)')
    expect(hud).toContain('lcd = new LiquidCrystal_I2C')
    // The screen is optional: every use is guarded.
    expect(hud).toContain('if (!lcd) return')
  })

  test('maps 0..1023 linearly to 0..300 bar, the cylinder’s full scale in the configuration', () => {
    expect(hud).toMatch(/ADC_MAX = 1023/)
    expect(hud).toMatch(new RegExp(`BAR_MAX = ${v(H.ari.startBar)}\\.0f`))
    expect(hud).toContain('raw * BAR_MAX / ADC_MAX')
  })

  test('sends ari_bar and mayday in the wire format, and the lines it prints parse with the app’s parser', () => {
    expect(hud).toContain('"ari_bar"')
    expect(hud).toContain('"mayday"')
    const ari = printed(hud, { '0': '101', '1': '184000', '2': 'ari_bar', '3': '145.0', '4': 'bar' })
    expect(parseLine(ari)).toMatchObject({ seq: 101, source: 'binome-hud', sensor: 'ari_bar', value: 145, unit: 'bar', room: 'binome-1' })
    const sos = printed(hud, { '0': '102', '1': '184120', '2': 'mayday', '3': '1', '4': 'bool' })
    expect(parseLine(sos)).toMatchObject({ sensor: 'mayday', value: 1, unit: 'bool', room: 'binome-1' })
  })

  test('understands the two commands of the browser, testing NO-GO before GO (NO-GO contains GO)', () => {
    expect(hud).toContain('\\"level\\":\\"NO-GO\\"')
    expect(hud).toContain('\\"level\\":\\"GO\\"')
    expect(hud.indexOf('"level\\":\\"NO-GO')).toBeLessThan(hud.indexOf('"level\\":\\"GO'))
    expect(hud).toContain('\\"cmd\\":\\"alert\\"')
  })

  test('a mayday is emitted once per wave of the hand, confirmed and re-armed, never stuck', () => {
    expect(hud).toContain('MAYDAY_CONFIRM_MS')
    expect(hud).toContain('MAYDAY_REARM_MS')
    expect(hud).toContain('!maydaySent')
  })
})

describe('the documentation', () => {
  test('lists both boards, the libraries, every pin of the wiring and the protocol', () => {
    for (const s of ['ESP32', 'STM32', 'GPIO 21', 'GPIO 22', 'GPIO 4', 'PA0', 'PA1', 'PB6', 'PB7', '115200', 'temp_bmp280', 'alt_bmp280', 'ari_bar', 'mayday', '{"cmd":"alert","level":"NO-GO"}', 'Adafruit BMP280', 'LiquidCrystal_I2C']) {
      expect(readme, s).toContain(s)
    }
  })

  test('says honestly what has and has not been tested', () => {
    expect(readme).toMatch(/non compil/i)
  })
})
