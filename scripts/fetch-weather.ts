// Fetches the outdoor wind at the site's coordinates from Open-Meteo and caches it in data/weather/open-meteo.json.
// The app reads only the cache (works offline during the demo). Status DERIVED: an analysis of numerical weather
// models, not a measurement on site. Run: node scripts/fetch-weather.ts

import { writeFileSync } from 'node:fs'
import site from '../data/site/atelier.json' with { type: 'json' }

const { lat, lon } = site.location
const url =
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
  '&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=Africa%2FTunis'

const res = await fetch(url, { headers: { 'User-Agent': 'pnr-demo' } })
if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
const j = (await res.json()) as {
  current: { time: string; temperature_2m: number; wind_speed_10m: number; wind_direction_10m: number; wind_gusts_10m: number }
}
const out = {
  source: 'Open-Meteo forecast API (current conditions), https://open-meteo.com — CC BY 4.0',
  url,
  status: 'DERIVED',
  note: 'Analysis of numerical weather models at the site coordinates, not a measurement on site.',
  fetchedAt: new Date().toISOString(),
  time: j.current.time,
  temperatureC: j.current.temperature_2m,
  windSpeedMs: j.current.wind_speed_10m,
  windGustMs: j.current.wind_gusts_10m,
  /** direction the wind blows FROM, degrees clockwise from north (meteorological convention) */
  windFromDeg: j.current.wind_direction_10m,
}
writeFileSync(new URL('../data/weather/open-meteo.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`wind ${out.windSpeedMs} m/s from ${out.windFromDeg}° (gusts ${out.windGustMs} m/s), ${out.temperatureC} °C at ${out.time}`)
