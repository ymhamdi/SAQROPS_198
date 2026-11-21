// Radio contact along a planned EVA: time without line of sight to any antenna (habitat or staged rover).

import type { TrackPoint } from './stats'

export interface CommsGaps {
  /** total EVA seconds out of line of sight */
  outS: number
  /** longest continuous stretch out of line of sight, s */
  longestS: number
  /** track index where the longest stretch starts, or -1 */
  longestStart: number
}

/**
 * Walks the track: each step's time is split between its two cells, and dwell at a cell counts for that cell.
 * `visible[cell]` = 1 when the cell has line of sight to an antenna. Riding points count as in contact (the rover's radio),
 * and so do points in sight of the rover parked near the crew on a rover-assisted plan (TrackPoint.roverInSight).
 */
export function commsGaps(track: TrackPoint[], visible: Uint8Array): CommsGaps {
  let outS = 0
  let runS = 0
  let runStart = -1
  let longestS = 0
  let longestStart = -1
  const addOut = (s: number, index: number) => {
    if (s <= 0) return
    if (runS === 0) runStart = index
    runS += s
    outS += s
    if (runS > longestS) {
      longestS = runS
      longestStart = runStart
    }
  }
  const contact = () => {
    runS = 0
  }
  const inContact = (p: TrackPoint) => p.riding === true || p.roverInSight === true || visible[p.cell] === 1
  for (let i = 0; i < track.length; i++) {
    const p = track[i]
    const seen = inContact(p)
    const dwell = p.departS - p.arriveS
    if (!seen) addOut(dwell, i)
    else if (dwell > 0) contact()
    if (i + 1 < track.length) {
      const half = (track[i + 1].arriveS - p.departS) / 2
      if (seen) contact()
      else addOut(half, i)
      if (inContact(track[i + 1])) contact()
      else addOut(half, i + 1)
    }
  }
  return { outS, longestS, longestStart }
}
