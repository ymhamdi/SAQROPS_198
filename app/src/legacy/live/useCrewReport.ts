import { useEffect, useRef } from 'react'
import type { CrewReport } from './link'

/** What a walk view reports about the crew; App adds which view and which plan. */
export type CrewPosition = Omit<CrewReport, 'view' | 'sig' | 'at'>

/** Reports the crew's position from a walk view whenever it changes. */
export function useCrewReport(onLive: ((p: CrewPosition) => void) | undefined, p: CrewPosition) {
  const cb = useRef(onLive)
  cb.current = onLive
  const { t, lat, lon, index, atStop, nextStation, abort, playing, speed, onDetour, planOffsetS } = p
  useEffect(() => {
    cb.current?.({ t, lat, lon, index, atStop, nextStation, abort, playing, speed, onDetour, planOffsetS })
  }, [t, lat, lon, index, atStop, nextStation, abort, playing, speed, onDetour, planOffsetS])
}
