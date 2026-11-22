// Plain maths for the twin's SVG curves.

/** Round tick values from 0 up to the first one at or above `max`, in about `count` steps of 1, 2 or 5 × 10^n. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let x = 0; ; x += step) {
    out.push(Math.round(x * 1e6) / 1e6)
    if (x >= max - step * 1e-9) break
  }
  return out
}

/** Splits a series into runs of consecutive points that have a value, so a gap (null) breaks the line. */
export function segments(xs: readonly number[], ys: readonly (number | null)[]): [number, number][][] {
  const runs: [number, number][][] = []
  let run: [number, number][] = []
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]
    if (y === null || y === undefined || !Number.isFinite(y)) {
      if (run.length) runs.push(run)
      run = []
    } else run.push([xs[i], y])
  }
  if (run.length) runs.push(run)
  return runs
}
