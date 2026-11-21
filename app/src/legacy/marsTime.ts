// Mars clock: the Mars24 algorithm (Allison & McEwen 2000, Planet. Space Sci. 48, 215; Allison 1997, GRL 24, 1967),
// as published at https://www.giss.nasa.gov/tools/mars24/help/algorithm.html. Step numbers below match that page.
// The coefficients are part of the published algorithm, so they live here rather than in config.ts.
// Longitudes in this app are east-positive; Mars24 uses west-positive, converted at the edges.

const DEG = Math.PI / 180

/** TAI − UTC (s) from each date on (IERS Bulletin C). Mars24 applies leap seconds up to the end of 2016. */
const LEAP_SECONDS: [string, number][] = [
  ['1972-01-01', 10], ['1972-07-01', 11], ['1973-01-01', 12], ['1974-01-01', 13], ['1975-01-01', 14],
  ['1976-01-01', 15], ['1977-01-01', 16], ['1978-01-01', 17], ['1979-01-01', 18], ['1980-01-01', 19],
  ['1981-07-01', 20], ['1982-07-01', 21], ['1983-07-01', 22], ['1985-07-01', 23], ['1988-01-01', 24],
  ['1990-01-01', 25], ['1991-01-01', 26], ['1992-07-01', 27], ['1993-07-01', 28], ['1994-07-01', 29],
  ['1996-01-01', 30], ['1997-07-01', 31], ['1999-01-01', 32], ['2006-01-01', 33], ['2009-01-01', 34],
  ['2012-07-01', 35], ['2015-07-01', 36], ['2017-01-01', 37],
] // prettier-ignore
const LEAP_SECONDS_MS = LEAP_SECONDS.map(([date, s]) => [Date.parse(`${date}T00:00:00Z`), s] as const)

/** Perturbations by Jupiter, Earth and Venus (step B-3): amplitude (°), period τ (Julian years), phase φ (°). */
const PERTURBERS: [number, number, number][] = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
]

export interface MarsTime {
  jdUT: number
  ttMinusUtcS: number
  jdTT: number
  /** days since J2000 (TT) */
  deltaJ2000: number
  meanAnomalyDeg: number
  fictitiousMeanSunDeg: number
  perturbersDeg: number
  /** equation of center, ν − M */
  equationOfCenterDeg: number
  /** areocentric solar longitude, the Mars season: 0° northern spring equinox, 90° summer, 180° autumn, 270° winter */
  lsDeg: number
  /** equation of time, degrees (÷ 15 for hours) */
  eotDeg: number
  /** Mars Sol Date */
  msd: number
  /** Coordinated Mars Time (Airy mean time), hours */
  mtcHours: number
  subsolarLonWestDeg: number
  declinationDeg: number
  heliocentricDistanceAU: number
}

const mod = (x: number, m: number) => ((x % m) + m) % m

/** TT − UTC in seconds at a UTC instant (step A-4). */
export function ttMinusUtcS(utcMs: number): number {
  if (utcMs < LEAP_SECONDS_MS[0][0]) {
    const t = (2440587.5 + utcMs / 8.64e7 - 2451545.0) / 36525 // step A-3
    return 64.184 + 59 * t - 51.2 * t ** 2 - 67.1 * t ** 3 - 16.4 * t ** 4
  }
  let taiMinusUtc = 0
  for (const [from, s] of LEAP_SECONDS_MS) if (utcMs >= from) taiMinusUtc = s
  return taiMinusUtc + 32.184
}

export function marsTime(utcMs: number): MarsTime {
  const jdUT = 2440587.5 + utcMs / 8.64e7 // A-2
  const ttUtc = ttMinusUtcS(utcMs) // A-4
  const jdTT = jdUT + ttUtc / 86400 // A-5
  const dt = jdTT - 2451545.0 // A-6

  const m = 19.3871 + 0.52402073 * dt // B-1
  const alphaFms = 270.3871 + 0.524038496 * dt // B-2
  const pbs = PERTURBERS.reduce((sum, [a, tau, phi]) => sum + a * Math.cos(((0.985626 * dt) / tau + phi) * DEG), 0) // B-3
  const mr = m * DEG
  const nuMinusM = // B-4
    (10.691 + 3.0e-7 * dt) * Math.sin(mr) +
    0.623 * Math.sin(2 * mr) +
    0.05 * Math.sin(3 * mr) +
    0.005 * Math.sin(4 * mr) +
    0.0005 * Math.sin(5 * mr) +
    pbs
  const ls = mod(alphaFms + nuMinusM, 360) // B-5
  const lsr = ls * DEG

  const eot = 2.861 * Math.sin(2 * lsr) - 0.071 * Math.sin(4 * lsr) + 0.002 * Math.sin(6 * lsr) - nuMinusM // C-1
  const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626 // C-2
  const mtc = mod(24 * msd, 24)
  const subsolarLonWest = mod(15 * mtc + eot + 180, 360) // C-5

  const declination = Math.asin(0.42565 * Math.sin(lsr)) / DEG + 0.25 * Math.sin(lsr) // D-1
  const distance = // D-2
    1.52367934 *
    (1.00436 - 0.09309 * Math.cos(mr) - 0.004336 * Math.cos(2 * mr) - 0.00031 * Math.cos(3 * mr) - 0.00003 * Math.cos(4 * mr))

  return {
    jdUT,
    ttMinusUtcS: ttUtc,
    jdTT,
    deltaJ2000: dt,
    meanAnomalyDeg: mod(m, 360),
    fictitiousMeanSunDeg: mod(alphaFms, 360),
    perturbersDeg: pbs,
    equationOfCenterDeg: nuMinusM,
    lsDeg: ls,
    eotDeg: eot,
    msd,
    mtcHours: mtc,
    subsolarLonWestDeg: subsolarLonWest,
    declinationDeg: declination,
    heliocentricDistanceAU: distance,
  }
}

/** Local mean solar time, hours (step C-3). */
export function lmstHours(t: MarsTime, lonEastDeg: number): number {
  return mod(t.mtcHours + lonEastDeg / 15, 24)
}

/** Local true solar time, hours (step C-4): noon = sun on the meridian. */
export function ltstHours(t: MarsTime, lonEastDeg: number): number {
  return mod(lmstHours(t, lonEastDeg) + t.eotDeg / 15, 24)
}

function hourAngleRad(t: MarsTime, lonEastDeg: number): number {
  return (mod(-lonEastDeg, 360) - t.subsolarLonWestDeg) * DEG // H = Λ − Λs, both west-positive
}

/** Solar zenith angle at a place, degrees (step D-5). Geometric: sun centre, no refraction. */
export function solarZenithDeg(t: MarsTime, latDeg: number, lonEastDeg: number): number {
  const phi = latDeg * DEG
  const dec = t.declinationDeg * DEG
  const cosZ = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(hourAngleRad(t, lonEastDeg))
  return Math.acos(Math.max(-1, Math.min(1, cosZ))) / DEG
}

/** Sun elevation above the horizon, degrees (90° − zenith). */
export function solarElevationDeg(t: MarsTime, latDeg: number, lonEastDeg: number): number {
  return 90 - solarZenithDeg(t, latDeg, lonEastDeg)
}

/** Solar azimuth, degrees clockwise from north (step D-6). */
export function solarAzimuthDeg(t: MarsTime, latDeg: number, lonEastDeg: number): number {
  const phi = latDeg * DEG
  const h = hourAngleRad(t, lonEastDeg)
  const a = Math.atan2(Math.sin(h), Math.cos(phi) * Math.tan(t.declinationDeg * DEG) - Math.sin(phi) * Math.cos(h))
  return mod(a / DEG, 360)
}

/**
 * Next time at or after fromMs (within 2 sols) when the sun sets, i.e. elevation goes down through
 * `horizonDeg`; null if it does not set (polar day). Scans in 10-minute steps, then bisects to ~1 s.
 */
export function nextSunsetMs(fromMs: number, latDeg: number, lonEastDeg: number, horizonDeg = 0): number | null {
  return nextCrossingMs(fromMs, latDeg, lonEastDeg, horizonDeg, 'down')
}

/** Next sunrise (elevation going up through horizonDeg) at or after fromMs, or null. */
export function nextSunriseMs(fromMs: number, latDeg: number, lonEastDeg: number, horizonDeg = 0): number | null {
  return nextCrossingMs(fromMs, latDeg, lonEastDeg, horizonDeg, 'up')
}

function nextCrossingMs(fromMs: number, lat: number, lon: number, horizon: number, dir: 'up' | 'down'): number | null {
  const above = (ms: number) => solarElevationDeg(marsTime(ms), lat, lon) > horizon
  const step = 10 * 60_000
  const limit = fromMs + 2 * 88_775_244
  let t0 = fromMs
  let a0 = above(t0)
  for (let t1 = fromMs + step; t1 <= limit; t1 += step) {
    const a1 = above(t1)
    if (dir === 'down' ? a0 && !a1 : !a0 && a1) {
      let lo = t0
      let hi = t1
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2
        if (above(mid) === a0) lo = mid
        else hi = mid
      }
      return Math.round((lo + hi) / 2)
    }
    t0 = t1
    a0 = a1
  }
  return null
}

/**
 * First UTC instant at or after fromMs when local true solar time at lonEastDeg reads `hour` (0–24), to ~1 s.
 * LTST advances one Mars hour per ~3699 s, so a 10-minute scan finds the wrap-safe crossing within one sol.
 */
export function nextLtstMs(fromMs: number, lonEastDeg: number, hour: number): number {
  // Hours still to go from `ltst` until the clock reads `hour`, in [0, 24).
  const ahead = (ms: number) => (((hour - ltstHours(marsTime(ms), lonEastDeg)) % 24) + 24) % 24
  if (ahead(fromMs) < 1e-6) return fromMs
  const step = 10 * 60_000
  let t0 = fromMs
  let a0 = ahead(t0)
  for (let t1 = fromMs + step; t1 <= fromMs + 2 * 88_775_244; t1 += step) {
    const a1 = ahead(t1)
    if (a1 > a0) {
      // `ahead` wrapped from near 0 back to near 24 between t0 and t1: the crossing is inside.
      let lo = t0
      let hi = t1
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2
        if (ahead(mid) <= ahead(lo)) lo = mid
        else hi = mid
      }
      return Math.round(hi)
    }
    t0 = t1
    a0 = a1
  }
  return fromMs
}

/** "13:09:55" from hours. */
export function formatMarsClock(hours: number): string {
  const s = Math.floor(mod(hours, 24) * 3600 + 1e-6)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}
