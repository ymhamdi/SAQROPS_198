// The view through the visor, stood in by a real Curiosity Navcam frame taken near where the crew is heading
// (OBSERVED). The HUD is designed over it, so its legibility over bright regolith is tested, not assumed.

import { useEffect, useMemo, useState } from 'react'
import { dataUrl, loadJson } from '../data/load'
import { sphericalDistanceM } from '../stats/stats'
import type { DataConfig, PovImage } from '../types'

/** Frames farther than this from the point are not used, m. */
const MAX_DISTANCE_M = 400

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** "Navcam, looking NNW" → 337.5; null when the camera line names no direction. */
export function lookingDeg(camera: string): number | null {
  const m = camera.match(/looking\s+([NSEW]{1,3})\b/i)
  const i = m ? POINTS.indexOf(m[1].toUpperCase()) : -1
  return i < 0 ? null : i * 22.5
}

/** The frame to show: the nearest location within reach, then the one facing closest to the bearing. */
export function pickFrame(frames: PovImage[], at: { lat: number; lon: number }, bearingDeg: number): (PovImage & { distanceM: number }) | null {
  const near = frames.map((f) => ({ ...f, distanceM: sphericalDistanceM(f, at) })).filter((f) => f.distanceM <= MAX_DISTANCE_M)
  if (near.length === 0) return null
  const closest = Math.min(...near.map((f) => f.distanceM))
  const turn = (f: PovImage) => {
    const d = lookingDeg(f.camera)
    return d === null ? 180 : Math.abs(((d - bearingDeg + 540) % 360) - 180)
  }
  return near.filter((f) => f.distanceM <= closest + 15).sort((a, b) => turn(a) - turn(b))[0]
}

let frames: Promise<PovImage[]> | null = null
function loadFrames(): Promise<PovImage[]> {
  frames ??= loadJson<DataConfig>('config.json')
    .then((c) => loadJson<PovImage[]>(c.povImages.path))
    .then((list) => list.filter((f) => !f.isPanorama))
    .catch(() => [])
  return frames
}

/**
 * The backdrop for a destination. Recomputed only when the destination or the coarse heading changes, so the view
 * does not flicker while the walk plays.
 */
export function useVisorBackdrop(at: { lat: number; lon: number } | null, bearingDeg: number) {
  const [list, setList] = useState<PovImage[]>([])
  useEffect(() => {
    let alive = true
    loadFrames().then((f) => alive && setList(f))
    return () => {
      alive = false
    }
  }, [])
  const sector = Math.round(bearingDeg / 45) % 8
  const key = at ? `${at.lat.toFixed(5)},${at.lon.toFixed(5)}` : ''
  return useMemo(() => {
    if (!at) return null
    const f = pickFrame(list, at, sector * 45)
    return f ? { url: dataUrl(f.url), sol: f.sol, camera: f.camera, distanceM: f.distanceM, status: f.status } : null
    // `at` is read through `key` (its rounded position), so a new object every frame does not recompute
  }, [list, key, sector])
}
