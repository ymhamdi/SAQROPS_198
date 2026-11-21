// Binary min-heap of (key, cell) pairs on typed arrays. Duplicates allowed; callers skip stale entries.

export interface Heap {
  push(key: number, cell: number): void
  /** Removes the smallest entry and returns its cell; -1 when empty. */
  pop(): number
  size(): number
}

export function createHeap(initialCapacity = 1024): Heap {
  let keys = new Float64Array(initialCapacity)
  let cells = new Int32Array(initialCapacity)
  let size = 0

  function push(key: number, cell: number) {
    if (size === keys.length) {
      const k = new Float64Array(size * 2)
      k.set(keys)
      keys = k
      const c = new Int32Array(size * 2)
      c.set(cells)
      cells = c
    }
    let i = size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      keys[i] = keys[parent]
      cells[i] = cells[parent]
      i = parent
    }
    keys[i] = key
    cells[i] = cell
  }

  function pop() {
    if (size === 0) return -1
    const top = cells[0]
    const key = keys[--size]
    const cell = cells[size]
    let i = 0
    while (true) {
      let child = 2 * i + 1
      if (child >= size) break
      if (child + 1 < size && keys[child + 1] < keys[child]) child++
      if (keys[child] >= key) break
      keys[i] = keys[child]
      cells[i] = cells[child]
      i = child
    }
    keys[i] = key
    cells[i] = cell
    return top
  }

  return { push, pop, size: () => size }
}
