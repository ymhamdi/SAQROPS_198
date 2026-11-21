import { useEffect, useRef, useState } from 'react'
import { compassPoint } from '../stats/eva'

interface Props {
  src: string
  /** equirectangular 360° image; width / height of the source */
  aspect: number
  /** heading to face first, degrees clockwise from north */
  initialHeadingDeg?: number
  label: string
}

/**
 * Drag (or arrow keys) to look around a 360° equirectangular panorama. Column 0 of the image looks north and
 * azimuth grows to the right, so the heading under the centre of the view is read straight off the offset.
 */
export function Panorama({ src, aspect, initialHeadingDeg = 0, label }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 360, h: 180 })
  const [heading, setHeading] = useState(initialHeadingDeg)
  const drag = useRef<{ x: number; heading: number } | null>(null)

  useEffect(() => setHeading(initialHeadingDeg), [src, initialHeadingDeg])

  useEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const imageWidth = size.h * aspect
  const degPerPx = 360 / imageWidth
  // Put `heading` at the centre of the view.
  const offset = size.w / 2 - (((heading % 360) + 360) % 360) / degPerPx

  return (
    <div
      ref={box}
      className="pano"
      role="slider"
      tabIndex={0}
      aria-label={`${label}: look around`}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(((heading % 360) + 360) % 360)}
      aria-valuetext={`Facing ${compassPoint(((heading % 360) + 360) % 360)}`}
      style={{ backgroundImage: `url("${src}")`, backgroundSize: `auto 100%`, backgroundPositionX: `${offset}px` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, heading }
      }}
      onPointerMove={(e) => {
        if (drag.current) setHeading(drag.current.heading - (e.clientX - drag.current.x) * degPerPx)
      }}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setHeading((h) => h - 15)
        if (e.key === 'ArrowRight') setHeading((h) => h + 15)
      }}
    >
      <span className="pano-heading">
        Facing {compassPoint(((heading % 360) + 360) % 360)} · {Math.round(((heading % 360) + 360) % 360)}°
      </span>
      <span className="pano-hint">Drag to look around</span>
    </div>
  )
}
