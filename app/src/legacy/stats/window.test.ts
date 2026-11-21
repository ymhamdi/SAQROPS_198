import { describe, expect, test } from 'vitest'
import type { EvaVerdict } from './goNoGo'
import { betterStart, windowLevel, type WindowSlot } from './window'

const verdict = (reasons: { code: string; severity: string; message: string }[]) => ({ reasons }) as unknown as EvaVerdict

describe('start window', () => {
  test('NO-GO beats a start-dependent caution; constant cautions do not colour the slot', () => {
    expect(windowLevel(verdict([{ code: 'SUNSET', severity: 'no-go', message: 'Sunset comes 1 h before the crew is back.' }])).level).toBe('nogo')
    expect(windowLevel(verdict([{ code: 'SPACE_WEATHER', severity: 'caution', message: 'Space-weather advisory until 16:00 UTC: CME.' }]))).toEqual({
      level: 'caution',
      why: 'Space-weather advisory until 16:00 UTC',
    })
    expect(windowLevel(verdict([{ code: 'STEEP_SECTIONS', severity: 'caution', message: 'About 500 m of route on slopes.' }]))).toEqual({ level: 'go', why: 'Clear' })
  })

  test('suggests the first clear start after the chosen one', () => {
    const slots: WindowSlot[] = ['caution', 'caution', 'go', 'go', 'nogo'].map((level, i) => ({
      time: new Date(Date.UTC(2025, 10, 13, 13 + i)).toISOString(), ltst: `0${7 + i}:30`, level: level as WindowSlot['level'], why: '',
    }))
    expect(betterStart(slots, slots[0].time)?.time).toBe(slots[2].time)
    expect(betterStart(slots, slots[2].time)).toBeNull() // already clear
    expect(betterStart(slots, slots[4].time)?.time).toBe(slots[2].time) // nothing clear later: the first clear one
  })
})
