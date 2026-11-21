import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { METERS_PER_DEG_LAT } from '../config'
import { DEFAULT_ROUTE_PARAMS } from '../route/cost'
import { gridFrom } from '../testing/grids'
import { INK, cellHazard, gridOverlayPixels, hazardRuns, hazardSpans, legHazardSeconds, walkHomePixels } from './overlays'
import { metresPerPixel, tileAt, tileDegrees } from './tiles'

describe('Mars Trek tile matrix (from curiosity_hirise_mosaic WMTSCapabilities.xml)', () => {
  test('level 0 is 2 x 1 tiles from -180/90; level 16 is 131072 x 65536', () => {
    expect(tileAt(89.9, -179.9, 0)).toEqual({ row: 0, col: 0 })
    expect(tileAt(-89.9, 179.9, 0)).toEqual({ row: 0, col: 1 })
    expect(360 / tileDegrees(16)).toBe(131072)
    expect(180 / tileDegrees(16)).toBe(65536)
  })

  test('the site centre maps to the tiles fetched from Trek on 2026-10-30', () => {
    // GET .../curiosity_hirise_mosaic/1.0.0//default/default028mm/{z}/{row}/{col}.png returned imagery for these.
    expect(tileAt(-4.8, 137.38, 12)).toEqual({ row: 2157, col: 7222 })
    expect(tileAt(-4.8, 137.38, 14)).toEqual({ row: 8628, col: 28888 })
    expect(tileAt(-4.8, 137.38, 16)).toEqual({ row: 34515, col: 115554 })
  })

  test('level 16 is ~0.64 m per pixel on Mars', () => {
    expect(metresPerPixel(16, METERS_PER_DEG_LAT)).toBeCloseTo(0.633, 2)
  })
})

describe('grid overlays', () => {
  test('terrain: bedrock transparent, sand / boulders / no-go coloured', () => {
    const g = gridFrom(['.sb#'])
    const px = gridOverlayPixels(g, 'terrain', DEFAULT_ROUTE_PARAMS)
    const alpha = [3, 7, 11, 15].map((i) => px[i])
    expect(alpha[0]).toBe(0)
    expect(alpha.slice(1).every((a) => a > 0)).toBe(true)
  })

  test('slope: transparent up to the penalty start, stronger amber toward the limit, dark when impassable', () => {
    const g = gridFrom(['....'])
    g.slopeDeg.set([10, 16, 24, 30])
    const px = gridOverlayPixels(g, 'slope', DEFAULT_ROUTE_PARAMS)
    expect(px[3]).toBe(0)
    expect([px[4], px[5], px[6]]).toEqual([0xf9, 0xab, 0x00])
    expect(px[11]).toBeGreaterThan(px[7])
    expect([px[12], px[13], px[14]]).toEqual([0x20, 0x21, 0x24])
  })

  test('legHazardSeconds sums each step into the hazard of the cell it enters', () => {
    const g = gridFrom(['..ss.'])
    const track = [0, 1, 2, 3, 4].map((cell, i) => ({ cell, arriveS: i * 10, departS: i * 10, leg: 0 }))
    expect(legHazardSeconds(g, track, 0, DEFAULT_ROUTE_PARAMS)).toEqual({ clear: 20, steep: 0, sand: 20, boulders: 0, blocked: 0 })
  })
})

describe('route hazards', () => {
  test('cell hazard priority: blocked > boulders > sand > steep > clear', () => {
    const g = gridFrom(['.sb#^.'])
    g.slopeDeg[5] = 18
    expect([0, 1, 2, 3, 4, 5].map((c) => cellHazard(g, c, DEFAULT_ROUTE_PARAMS))).toEqual([
      'clear',
      'sand',
      'boulders',
      'blocked',
      'blocked',
      'steep',
    ])
  })

  test('runs share boundary cells so the drawn line is continuous', () => {
    const g = gridFrom(['..ss..'])
    const runs = hazardRuns(g, [0, 1, 2, 3, 4, 5], DEFAULT_ROUTE_PARAMS)
    expect(runs).toEqual([
      { hazard: 'clear', cells: [0, 1, 2] },
      { hazard: 'sand', cells: [2, 3, 4] },
      { hazard: 'clear', cells: [4, 5] },
    ])
  })
})

describe('one palette', () => {
  test('the CSS tokens and the map inks are the same colours', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase()
    expect({ blue: token('blue'), amber: token('amber'), red: token('red'), green: token('green'), traverse: token('traverse'), rejoin: token('rejoin'), draft: token('draft'), text: token('text'), onAccent: token('on-accent') }).toEqual({
      blue: INK.blue,
      amber: INK.amber,
      red: INK.red,
      green: INK.green,
      traverse: INK.traverse,
      rejoin: INK.rejoin,
      draft: INK.draft,
      text: INK.black,
      onAccent: INK.white,
    })
  })
})

describe('hazard spans along a track', () => {
  test('equal neighbours merge; spans share their boundary point so the line is unbroken', () => {
    expect(hazardSpans(['clear', 'clear', 'sand', 'sand', 'sand', 'clear'])).toEqual([
      { hazard: 'clear', from: 0, to: 2 },
      { hazard: 'sand', from: 2, to: 5 },
      { hazard: 'clear', from: 5, to: 5 },
    ])
    expect(hazardSpans(['steep'])).toEqual([{ hazard: 'steep', from: 0, to: 0 }])
    expect(hazardSpans([])).toEqual([])
  })
})

describe('walk-home heatmap', () => {
  test('bands by minutes; unreachable cells are dark', () => {
    const px = walkHomePixels(new Float32Array([0, 15 * 60, 50 * 60, 2 * 3600, Infinity]))
    const rgb = (i: number) => [px[4 * i], px[4 * i + 1], px[4 * i + 2]]
    expect(rgb(0)).toEqual([0x18, 0x80, 0x38])
    expect(rgb(1)).toEqual([0x7c, 0xb3, 0x42])
    expect(rgb(2)).toEqual([0xd9, 0x30, 0x25])
    expect(rgb(3)).toEqual([0x8c, 0x1d, 0x18])
    expect(rgb(4)).toEqual([0x20, 0x21, 0x24])
  })
})
