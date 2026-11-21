import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { SLOPE_IMPASSABLE_DEG, SLOPE_PENALTY_START_DEG, TERRAIN_COST_MULTIPLIER } from './config'
import { TERRAIN, type Bounds, type DataConfig, type DataStatus, type DataType } from './types'

const STATUSES: DataStatus[] = ['OBSERVED', 'DERIVED', 'MODELED', 'MOCK']
const DATA_TYPES: DataType[] = [
  'optical',
  'thermal',
  'spectral',
  'topographic',
  'atmospheric',
  'radiation',
  'chemical',
  'derived',
]

// data/ is git-ignored, so these checks run only where it exists (not in CI).
const CONFIG_URL = new URL('../../data/config.json', import.meta.url)
const hasData = existsSync(CONFIG_URL)
const config = (hasData ? JSON.parse(readFileSync(CONFIG_URL, 'utf-8')) : null) as DataConfig

function isValidBounds(b: Bounds) {
  return b.latMin < b.latMax && b.lonMin < b.lonMax && b.latMin >= -90 && b.latMax <= 90
}

function contains(outer: Bounds, inner: Bounds) {
  return (
    inner.latMin >= outer.latMin &&
    inner.latMax <= outer.latMax &&
    inner.lonMin >= outer.lonMin &&
    inner.lonMax <= outer.lonMax
  )
}

describe.skipIf(!hasData)('data/config.json', () => {
  test('site has valid bounds and status', () => {
    expect(isValidBounds(config.site.bounds)).toBe(true)
    expect(STATUSES).toContain(config.site.boundsStatus)
  })

  test('layers follow the Layer contract', () => {
    const ids = config.layers.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const layer of config.layers) {
      expect(STATUSES).toContain(layer.status)
      expect(DATA_TYPES).toContain(layer.dataType)
      expect(Boolean(layer.tileUrl) !== Boolean(layer.imageOverlay)).toBe(true)
      expect(layer.opacity).toBeGreaterThanOrEqual(0)
      expect(layer.opacity).toBeLessThanOrEqual(1)
      expect(isValidBounds(layer.bounds)).toBe(true)
      // Image overlays are cut to the site; a tile layer's bounds are its coverage, which must include the site.
      if (layer.imageOverlay) expect(contains(config.site.bounds, layer.bounds)).toBe(true)
      else expect(contains(layer.bounds, config.site.bounds)).toBe(true)
      expect(layer.attribution.length).toBeGreaterThan(0)
    }
  })

  test('initial layers exist; zoom range is sane', () => {
    const ids = new Set(config.layers.map((l) => l.id))
    for (const id of config.initialLayers) expect(ids).toContain(id)
    expect(config.site.zoom.min).toBeLessThan(config.site.zoom.max)
  })

  test('every non-MOCK layer has a provenance entry in data/SOURCES.md', () => {
    const sources = readFileSync(new URL('../../data/SOURCES.md', import.meta.url), 'utf-8')
    for (const layer of config.layers.filter((l) => l.status !== 'MOCK')) {
      expect(sources).toContain(`Used as: layer \`${layer.id}\``)
    }
  })

  test('layers cover at least three data types (challenge brief)', () => {
    expect(new Set(config.layers.map((l) => l.dataType)).size).toBeGreaterThanOrEqual(3)
  })

  test('non-layer datasets have a path and status', () => {
    expect(config.costGrid).toMatch(/\.json$/)
    for (const d of [config.scienceTargets, config.povImages, config.conditions, config.waypoints]) {
      expect(d.path).toMatch(/\.json$/)
      expect(STATUSES).toContain(d.status)
    }
  })
})

describe('config.ts', () => {
  test('slope penalty starts below the impassable limit', () => {
    expect(SLOPE_PENALTY_START_DEG).toBeLessThan(SLOPE_IMPASSABLE_DEG)
  })

  test('every terrain class has a cost multiplier; only NO_GO is impassable', () => {
    for (const code of Object.values(TERRAIN)) {
      expect(TERRAIN_COST_MULTIPLIER[code]).toBeGreaterThanOrEqual(1)
    }
    expect(TERRAIN_COST_MULTIPLIER[TERRAIN.NO_GO]).toBe(Infinity)
    expect(Number.isFinite(TERRAIN_COST_MULTIPLIER[TERRAIN.SAND])).toBe(true)
  })
})
