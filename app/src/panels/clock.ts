/** Simulated seconds as « T+m:ss », the clock of the PC, the tablet and the rehearsal. */
export const clock = (s: number) => `T+${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
