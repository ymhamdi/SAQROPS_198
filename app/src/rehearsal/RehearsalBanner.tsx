// R12: everything that comes from the rehearsal says « RÉPÉTITION — SIMULATION », in a frame and a colour that the live
// views never use (violet, dashed). The rehearsal never appears on the live HUD.

import type { ReactNode } from 'react'
import './rehearsal.css'

export const REHEARSAL_BANNER = 'RÉPÉTITION — SIMULATION'

export function RehearsalBanner() {
  return (
    <p className="rehearsal-banner" role="note">
      {REHEARSAL_BANNER}
    </p>
  )
}

/** The frame of every rehearsal surface: dashed, violet, with the banner on top. */
export function RehearsalFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rehearsal-frame ${className}`.trim()}>
      <RehearsalBanner />
      {children}
    </section>
  )
}
