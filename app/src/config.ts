// Every assumption comes from data/config.json, with its source and status (CLAUDE.md R4). No magic numbers in app/src:
// read them here. Plain .ts imports so the fire engine and ml/generate.ts can run under Node without a build.

import data from '../../data/config.json' with { type: 'json' }
import type { DataStatus } from './types.ts'

export interface Hypothesis<T = number> {
  value: T
  unit: string
  source: string
  status: DataStatus
}

export const CONFIG = data
export const H = data.hypotheses

/** The value of a hypothesis. */
export function v<T>(h: { value: T }): T {
  return h.value
}

/** Every hypothesis as [dotted path, entry], for checks and for listing sources. */
export function allHypotheses(): [string, Hypothesis<unknown>][] {
  const out: [string, Hypothesis<unknown>][] = []
  for (const [section, entries] of Object.entries(data.hypotheses)) {
    for (const [key, h] of Object.entries(entries as Record<string, Hypothesis<unknown>>)) out.push([`${section}.${key}`, h])
  }
  return out
}
