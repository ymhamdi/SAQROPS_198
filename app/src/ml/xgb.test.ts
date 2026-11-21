// R8: the TypeScript evaluator reproduces the Python predictions to 1e-6 on golden.csv, missing values included, for the
// shipped model (ml/model) and for every other exported model folder that has a golden.csv (ml/model-v4: real data).

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import contract from '../../../ml/model/contract.json' with { type: 'json' }
import { FEATURE_NAMES } from './features'
import { parseXgb, predict } from './xgb'

const MODEL_DIR = new URL('../../../ml/model/', import.meta.url)
const MODEL_DIRS = ['model', 'model-v4'].map((d) => new URL(`../../../ml/${d}/`, import.meta.url)).filter((u) => existsSync(new URL('golden.csv', u)))
const loadFrom = (dir: URL, file: string) => parseXgb(JSON.parse(readFileSync(new URL(file, dir), 'utf-8')))
const load = (file: string) => loadFrom(MODEL_DIR, file)

function readGolden(dir: URL) {
  const [head, ...lines] = readFileSync(new URL('golden.csv', dir), 'utf-8').trim().split('\n')
  const cols = head.split(',')
  return {
    cols,
    rows: lines.map((l) => l.split(',').map((c) => (c === '' ? NaN : Number(c)))),
  }
}

test('the shipped model folder has its golden.csv', () => {
  expect(MODEL_DIRS.map((u) => u.href)).toContain(MODEL_DIR.href)
})

describe.each(MODEL_DIRS.map((u) => [u.pathname.split('/').at(-2)!, u] as const))('R8 model parity (ml/%s/golden.csv)', (_name, dir) => {
  const golden = readGolden(dir)
  const nF = FEATURE_NAMES.length

  test('golden columns follow the contract', () => {
    expect(golden.cols.slice(0, nF)).toEqual(FEATURE_NAMES)
    expect(golden.cols.slice(nF)).toEqual(['p30', 'p60', 'tff'])
  })

  test('golden rows include missing values (failed detectors)', () => {
    expect(golden.rows.some((r) => r.slice(0, nF).some(Number.isNaN))).toBe(true)
  })

  for (const [key, spec] of Object.entries(contract.models)) {
    test(`${key} (${spec.file}) matches Python to 1e-6`, () => {
      const model = loadFrom(dir, spec.file)
      expect(model.objective).toBe(spec.objective)
      expect(model.nFeatures).toBe(nF)
      const col = golden.cols.indexOf(key)
      for (const r of golden.rows) {
        const want = r[col]
        const got = predict(model, r.slice(0, nF))
        expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(want)))
      }
    })
  }
})

describe('xgb evaluator', () => {
  test('rejects a row of the wrong length', () => {
    const model = load(contract.models.p30.file)
    expect(() => predict(model, [1, 2, 3])).toThrow(/features/)
  })

  test('rejects what is not an XGBoost model', () => {
    expect(() => parseXgb({ foo: 1 })).toThrow(/not an XGBoost/)
  })

  test('probabilities stay in [0, 1] even with every input missing', () => {
    const model = load(contract.models.p60.file)
    const p = predict(model, new Array(nFeatures()).fill(NaN))
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})

function nFeatures() {
  return FEATURE_NAMES.length
}
