// Bench check of a real board (firmware/README.md §7): every line a board printed, through the app's own parser.
// From app/: BENCH_CAPTURE=<file> BENCH_SOURCE=<binome-hud|drone-payload> npx vitest run src/hardware/benchCapture.test.ts
// Without BENCH_CAPTURE the test is skipped, so npm test is unaffected.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { parseLine } from './protocol'

const file = process.env.BENCH_CAPTURE ?? ''
const source = process.env.BENCH_SOURCE ?? ''
const UNITS: Record<string, string> = { temp_bmp280: 'C', alt_bmp280: 'm', ari_bar: 'bar', mayday: 'bool' }

test.runIf(file !== '')(`bench capture ${source}`, () => {
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n').map((l) => l.trim()).filter(Boolean)
  let parsed = 0
  let lastSeq = -1
  const rejected: string[] = []
  const bySensor: Record<string, number[]> = {}
  const rooms = new Set<string>()
  for (const l of lines) {
    const m = parseLine(l)
    if (!m) {
      rejected.push(l.slice(0, 80))
      continue
    }
    parsed++
    expect(m.source).toBe(source)
    expect(m.unit).toBe(UNITS[m.sensor])
    expect(m.seq).toBeGreaterThan(lastSeq)
    lastSeq = m.seq
    ;(bySensor[m.sensor] ??= []).push(m.value)
    rooms.add(m.room)
  }
  const summary = Object.entries(bySensor).map(([s, v]) => `${s}: ${v.length} (min ${Math.min(...v)}, max ${Math.max(...v)})`)
  console.log(`[bench] ${lines.length} lines, ${parsed} parsed, ${rejected.length} rejected; ${summary.join('; ')}; rooms: ${[...rooms].join(', ')}`)
  if (rejected.length) console.log(`[bench] rejected: ${rejected.join(' | ')}`)
  expect(parsed).toBeGreaterThan(0)
})
