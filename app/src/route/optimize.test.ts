import { describe, expect, test } from 'vitest'
import { bestOrder, nearestHaven, tourTime, type TimeMatrix } from './optimize'

/** Points on a line at positions xs (base first); time = distance, plus `uphill` extra per unit going right. */
function lineMatrix(xs: number[], uphill = 0): TimeMatrix {
  return xs.map((a) => xs.map((b) => Math.abs(b - a) + (b > a ? uphill * (b - a) : 0)))
}

function bruteForce(matrix: TimeMatrix): number {
  const n = matrix.length - 1
  let best = Infinity
  const perm = (rest: number[], acc: number[]) => {
    if (!rest.length) best = Math.min(best, tourTime(matrix, acc))
    rest.forEach((r, i) => perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, r]))
  }
  perm(Array.from({ length: n }, (_, i) => i + 1), [])
  return best
}

describe('bestOrder', () => {
  test('visits stops along a line in order, out and back', () => {
    const m = lineMatrix([0, 3, 1, 2])
    const order = bestOrder(m)!
    expect(tourTime(m, order)).toBe(6)
    expect([[2, 3, 1], [1, 3, 2]]).toContainEqual(order)
  })

  test('matches brute force on random asymmetric matrices', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let trial = 0; trial < 20; trial++) {
      const n = 2 + (trial % 6)
      const m = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === j ? 0 : 1 + rand() * 100)))
      expect(tourTime(m, bestOrder(m)!)).toBeCloseTo(bruteForce(m), 9)
    }
  })

  test('respects direction: climbing is slower, so the cheaper direction wins', () => {
    const m = lineMatrix([0, 1, 2], 1)
    expect(tourTime(m, bestOrder(m)!)).toBe(bruteForce(m))
  })

  test('no order when a stop cannot be reached', () => {
    const m = [
      [0, 1, Infinity],
      [1, 0, Infinity],
      [Infinity, Infinity, 0],
    ]
    expect(bestOrder(m)).toBeNull()
  })

  test('large tours fall back to a valid permutation', () => {
    const xs = [0, 5, 3, 9, 1, 7, 2, 8, 4, 6, 10, 11]
    const order = bestOrder(lineMatrix(xs))!
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: xs.length - 1 }, (_, i) => i + 1))
    expect(tourTime(lineMatrix(xs), order)).toBe(22)
  })
})

test('nearestHaven takes the element-wise minimum', () => {
  const a = new Float32Array([5, Infinity, 3])
  const b = new Float32Array([4, 9, Infinity])
  expect(Array.from(nearestHaven([a, b]))).toEqual([4, 9, 3])
})
