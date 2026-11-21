import { describe, expect, test } from 'vitest'
import { prepareGrid } from '../route/cost'
import { findPath, walkHomeField } from '../route/search'
import { nearestHaven } from '../route/optimize'
import { CELL } from '../types'
import { buildSite, cellAt, cellCentre, neighbours } from './site'

const site = buildSite()
const clearPace = () => new Float32Array(site.rooms.length).fill(1)

describe('site grid (data/site/atelier.json)', () => {
  test('140 × 100 cells of 0.5 m: the 60 × 40 m building and a 5 m margin', () => {
    expect(site.width).toBe(140)
    expect(site.height).toBe(100)
    expect(site.cellM).toBe(0.5)
  })

  test('every door joins exactly two sides and every exit leads outside', () => {
    for (const d of site.doors) {
      expect(d.rooms[0]).not.toBe(d.rooms[1])
      if (d.isExit) expect(d.rooms).toContain(-1)
      else expect(d.rooms).not.toContain(-1)
    }
    expect(site.exits).toHaveLength(3)
  })

  test('the solvent store and the paint booth are neighbours (the demo door)', () => {
    const sol = site.rooms.findIndex((r) => r.id === 'solvants')
    const pei = site.rooms.findIndex((r) => r.id === 'peinture')
    expect(neighbours(site, sol)).toContain(pei)
  })

  test('every room with the flashover model has at least one detector', () => {
    for (const r of site.rooms.filter((x) => x.flashoverModel)) expect(site.detectors.some((d) => d.room === r.index), r.id).toBe(true)
  })

  test('walls and equipment are impassable; floor, doors and exits are not', () => {
    const p = prepareGrid(site, clearPace())
    for (let i = 0; i < site.kind.length; i++) {
      const blocked = site.kind[i] === CELL.WALL || site.kind[i] === CELL.OBSTACLE
      expect(Number.isFinite(p.pace[i])).toBe(!blocked)
    }
  })

  test('every objective is reachable from the demo entry, and every room has a way out', () => {
    const p = prepareGrid(site, clearPace())
    const entry = site.doors[site.demo.entry].cells[0]
    for (const o of site.objectives) expect(findPath(p, entry, o.cell), o.id).not.toBeNull()
    const out = nearestHaven(site.exits.map((e) => walkHomeField(p, site.doors[e].cells[0])))
    for (const r of site.rooms) expect(Number.isFinite(out[r.cells[Math.floor(r.cells.length / 2)]]), r.id).toBe(true)
  })

  test('cellAt and cellCentre agree', () => {
    const c = cellAt(site, { x: 12.3, y: 40.1 })
    const centre = cellCentre(site, c)
    expect(cellAt(site, centre)).toBe(c)
    expect(Math.abs(centre.x - 12.3)).toBeLessThan(site.cellM)
  })
})
