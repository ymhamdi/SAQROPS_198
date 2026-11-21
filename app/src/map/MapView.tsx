import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { dataUrl } from '../data/load'
import type { RouteParams } from '../route/cost'
import { cellCenter, type RouteResult } from '../route/route'
import type { Bounds, CostGrid, DataConfig, Layer, ScienceTarget, Waypoint, RoverTraverse } from '../types'
import { MARS_CRS } from './crs'
import { gridOverlayPixels, HAZARD_COLORS, hazardRuns, INK, walkHomePixels, type GridOverlayMode, radioPixels } from './overlays'

export interface LayerState {
  visible: boolean
  opacity: number
}

interface Props {
  config: DataConfig
  grid: CostGrid
  routeParams: RouteParams
  layerState: Record<string, LayerState>
  overlay: GridOverlayMode
  base: Waypoint
  targets: ScienceTarget[]
  stops: Waypoint[]
  route: RouteResult | null
  /** the other alternative, drawn grey under the chosen route; click it to switch */
  altRoute: RouteResult | null
  onPickAlternative: () => void
  onMapClick: (lat: number, lon: number) => void
  onTargetClick: (target: ScienceTarget) => void
  /** 0 = habitat, n = stop n */
  selected: number | null
  onSelectStation: (station: number) => void
  /** a point on the route to mark (hover on the elevation profile) */
  hoverPoint: { lat: number; lon: number } | null
  /** seconds to the nearest safe haven from every cell, for the walk-home heatmap */
  walkHome: Float32Array | null
  /** where the rover is staged or parks (safe haven), when not at the habitat */
  rovers: { lat: number; lon: number; title: string; note: string }[]
  /** a rover's real drive path to draw, or null */
  traverse: RoverTraverse | null
  /** 1 per cell with radio line of sight to the habitat or the staged rover, for the radio overlay */
  lineOfSight: Uint8Array | null
}

const toLatLngBounds = (b: Bounds) => L.latLngBounds([b.latMin, b.lonMin], [b.latMax, b.lonMax])

/** zIndex = position in config.layers, so toggling a layer back on keeps the configured stacking order. */
function createLayer(layer: Layer, zIndex: number, maxZoom: number): L.Layer {
  const bounds = toLatLngBounds(layer.bounds)
  const common = { opacity: layer.opacity, attribution: layer.attribution, zIndex }
  if (layer.tileUrl) return L.tileLayer(layer.tileUrl, { ...common, bounds, maxZoom, maxNativeZoom: maxZoom })
  return L.imageOverlay(dataUrl(layer.imageOverlay!), bounds, { ...common, className: 'pixelated' })
}

function gridOverlayImage(grid: CostGrid, mode: Exclude<GridOverlayMode, 'none'>, p: RouteParams, walkHome: Float32Array | null, lineOfSight: Uint8Array | null): string {
  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const pixels = mode === 'walkhome' ? walkHomePixels(walkHome!) : mode === 'radio' ? radioPixels(lineOfSight!) : gridOverlayPixels(grid, mode, p)
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, grid.width, grid.height), 0, 0)
  return canvas.toDataURL()
}

export function MapView(props: Props) {
  const { config, grid, routeParams, layerState, overlay, base, targets, stops, route, altRoute, selected, hoverPoint, walkHome, rovers, traverse, lineOfSight } = props
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layers = useRef<Map<string, L.Layer>>(new Map())
  const callbacks = useRef(props)
  callbacks.current = props

  // Map and data layers: once per config.
  useEffect(() => {
    const site = toLatLngBounds(config.site.bounds)
    const map = L.map(container.current!, {
      crs: MARS_CRS,
      minZoom: config.site.zoom.min,
      maxZoom: config.site.zoom.max,
      maxBounds: site.pad(1),
      zoomSnap: 1, // whole zoom levels: tiles line up exactly, so no hairline seams between them
      zoomControl: false,
    })
    // On wide screens the directions card floats over the left of the map: keep the site clear of it.
    const cardWidth = window.innerWidth > 960 ? 440 : 0
    map.fitBounds(site, { paddingTopLeft: [cardWidth + 24, 72], paddingBottomRight: [24, 24] })
    const zoom = L.control.zoom({ position: 'bottomright' }).addTo(map)
    // Authored icons in place of Leaflet's text glyphs (same 24px grid and 1.75 stroke as ui/icons.tsx).
    const icon = (d: string) =>
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="${d}"/></svg>`
    const zoomBox = zoom.getContainer()!
    zoomBox.querySelector('.leaflet-control-zoom-in')!.innerHTML = icon('M12 5v14M5 12h14')
    zoomBox.querySelector('.leaflet-control-zoom-out')!.innerHTML = icon('M5 12h14')
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map)
    map.attributionControl.setPrefix(false)
    map.createPane('grid').style.zIndex = '410'
    map.createPane('traverse').style.zIndex = '412' // the rover's real path, under the planned routes
    map.createPane('alt').style.zIndex = '415' // the unchosen alternative, under the chosen route
    map.createPane('route').style.zIndex = '420'
    map.createPane('pins').style.zIndex = '430' // above the route line, so its casing never covers a pin
    map.on('click', (e: L.LeafletMouseEvent) => callbacks.current.onMapClick(e.latlng.lat, e.latlng.lng))
    config.layers.forEach((layer, i) => layers.current.set(layer.id, createLayer(layer, i + 1, config.site.zoom.max)))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layers.current.clear()
    }
  }, [config])

  // Layer visibility and opacity.
  useEffect(() => {
    const map = mapRef.current!
    for (const layer of config.layers) {
      const l = layers.current.get(layer.id) as L.TileLayer | L.ImageOverlay
      const state = layerState[layer.id]
      if (state?.visible) {
        if (!map.hasLayer(l)) l.addTo(map)
        l.setOpacity(state.opacity)
      } else if (map.hasLayer(l)) {
        l.remove()
      }
    }
  }, [config, layerState])

  // Slope / terrain / walk-home overlay drawn from the CostGrid.
  useEffect(() => {
    if (overlay === 'none' || (overlay === 'walkhome' && !walkHome) || (overlay === 'radio' && !lineOfSight)) return
    const image = L.imageOverlay(gridOverlayImage(grid, overlay, routeParams, walkHome, lineOfSight), toLatLngBounds(grid.bounds), {
      pane: 'grid',
      className: 'pixelated',
      interactive: false,
    }).addTo(mapRef.current!)
    return () => {
      image.remove()
    }
  }, [config, grid, overlay, routeParams, walkHome, lineOfSight])

  // The rover, staged as a safe haven, or every spot where it parks on a rover-assisted plan.
  useEffect(() => {
    if (rovers.length === 0) return
    const icon = L.divIcon({
      className: 'map-mark mark-rover',
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15h18v-4l-3-4H8L5 11H3z"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/></svg>',
      iconSize: [30, 30],
      iconAnchor: [15, 34],
    })
    const esc = (s: string) => s.replace(/[&<>"']/g, '')
    const marks = rovers.map((r) =>
      L.marker([r.lat, r.lon], { pane: 'pins', icon, keyboard: false })
        .bindTooltip(`<strong>${esc(r.title)}</strong><span>${esc(r.note)}</span>`, { direction: 'top', offset: [0, -34], className: 'map-tip' })
        .addTo(mapRef.current!),
    )
    return () => {
      for (const m of marks) m.remove()
    }
  }, [rovers])

  // Habitat, science targets and stops. Names show on hover; the numbers match the directions list.
  useEffect(() => {
    const group = L.layerGroup().addTo(mapRef.current!)
    const mark = (className: string, html: string, size: number) =>
      L.divIcon({ className: `map-mark ${className}`, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    const tip = (title: string, detail: string) => `<strong>${esc(title)}</strong><span>${esc(detail)}</span>`
    const tipOptions = (size: number): L.TooltipOptions => ({ direction: 'top', offset: [0, -size / 2 - 4], className: 'map-tip' })

    const sel = (n: number) => (selected === n ? ' is-selected' : '')
    L.marker([base.lat, base.lon], { pane: 'pins', icon: mark(`mark-home${sel(0)}`, '', 28), keyboard: false })
      .bindTooltip(tip(base.name, 'Start and end of every walk'), tipOptions(28))
      .on('click', () => callbacks.current.onSelectStation(0))
      .addTo(group)
    for (const t of targets) {
      if (stops.some((s) => s.id === t.id)) continue
      L.marker([t.lat, t.lon], { pane: 'pins', icon: mark('mark-target', '', 18), title: `Add ${t.name}` })
        .bindTooltip(tip(t.name, `Science target (${t.status}) · click to add`), tipOptions(18))
        .on('click', () => callbacks.current.onTargetClick(t))
        .addTo(group)
    }
    stops.forEach((s, i) => {
      L.marker([s.lat, s.lon], { pane: 'pins', icon: mark(`mark-stop${sel(i + 1)}`, String(i + 1), 26), keyboard: false })
        .bindTooltip(tip(`${i + 1}. ${s.name}`, s.kind === 'science' ? 'Science stop · click for details' : 'Via point'), tipOptions(26))
        .on('click', () => callbacks.current.onSelectStation(i + 1))
        .addTo(group)
    })
    return () => {
      group.remove()
    }
  }, [config, base, targets, stops, selected])

  // The other alternative, grey like an unselected route on a road map; clicking it switches.
  useEffect(() => {
    if (!altRoute?.ok) return
    const group = L.layerGroup().addTo(mapRef.current!)
    for (const leg of altRoute.legs) {
      const points = leg.cells.map((c) => {
        const { lat, lon } = cellCenter(grid, c)
        return L.latLng(lat, lon)
      })
      const line = { pane: 'alt', lineCap: 'round', lineJoin: 'round' } as const
      L.polyline(points, { ...line, color: INK.white, weight: 9, opacity: 0.9, interactive: false }).addTo(group)
      L.polyline(points, { ...line, color: INK.alternative, weight: 5, className: 'alt-route' })
        .bindTooltip('Other option: click to switch', { sticky: true, className: 'map-tip' })
        .on('click', () => callbacks.current.onPickAlternative())
        .addTo(group)
    }
    return () => {
      group.remove()
    }
  }, [grid, altRoute])

  // The point under the cursor on the elevation profile.
  useEffect(() => {
    if (!hoverPoint) return
    const dot = L.circleMarker([hoverPoint.lat, hoverPoint.lon], {
      pane: 'pins',
      radius: 7,
      color: INK.white,
      weight: 3,
      fillColor: INK.black,
      fillOpacity: 1,
      interactive: false,
    }).addTo(mapRef.current!)
    return () => {
      dot.remove()
    }
  }, [hoverPoint])

  // The rover's real drive path: dashed, under the planned routes, with its sol range on hover.
  useEffect(() => {
    if (!traverse || traverse.points.length < 2) return
    const pts = traverse.points.map((p) => L.latLng(p.lat, p.lon))
    const first = traverse.points[0].sol
    const last = traverse.points[traverse.points.length - 1].sol
    const group = L.layerGroup().addTo(mapRef.current!)
    L.polyline(pts, { pane: 'traverse', color: INK.white, weight: 6, opacity: 0.8, interactive: false }).addTo(group)
    L.polyline(pts, { pane: 'traverse', color: INK.traverse, weight: 3, dashArray: '6 6' })
      .bindTooltip(`${traverse.rover}'s real path, sols ${first}–${last}`, { sticky: true })
      .addTo(group)
    return () => {
      group.remove()
    }
  }, [traverse])

  // Route, each run coloured by its hazard.
  useEffect(() => {
    if (!route?.ok) return
    const group = L.layerGroup().addTo(mapRef.current!)
    const line = { pane: 'route', interactive: false, lineCap: 'round', lineJoin: 'round' } as const
    const toLatLng = (c: number) => {
      const { lat, lon } = cellCenter(grid, c)
      return L.latLng(lat, lon)
    }
    for (const leg of route.legs) {
      // Split each leg into ridden and walked stretches (rover-assisted plans); a shared cell joins the two.
      const parts: { riding: boolean; cells: number[] }[] = []
      leg.cells.forEach((c, k) => {
        const riding = leg.ride?.[k] === 1 || (k === 0 && leg.ride?.[1] === 1)
        const lastPart = parts[parts.length - 1]
        if (!lastPart || lastPart.riding !== riding) parts.push({ riding, cells: lastPart ? [lastPart.cells[lastPart.cells.length - 1], c] : [c] })
        else lastPart.cells.push(c)
      })
      for (const part of parts) {
        if (part.riding) {
          const points = part.cells.map(toLatLng)
          L.polyline(points, { ...line, color: INK.white, weight: 9 }).addTo(group)
          L.polyline(points, { ...line, color: INK.rover, weight: 5, dashArray: '10 8', lineCap: 'butt' }).addTo(group)
          continue
        }
        for (const run of hazardRuns(grid, part.cells, routeParams)) {
          const points = run.cells.map(toLatLng)
          // White casing under the colour, as on a road map, so the line holds on dark and light ground alike.
          L.polyline(points, { ...line, color: INK.white, weight: 10 }).addTo(group)
          L.polyline(points, { ...line, color: HAZARD_COLORS[run.hazard], weight: 6 }).addTo(group)
        }
      }
    }
    return () => {
      group.remove()
    }
  }, [config, grid, route, routeParams])

  return <div ref={container} className="map" />
}
