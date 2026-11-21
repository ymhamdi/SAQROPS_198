// Data contracts between the pipeline and the app (CLAUDE.md §5).
// The pipeline must output exactly these shapes. Change only after proposing it.
//
// Coordinates: planetocentric latitude, east-positive longitude, degrees.
// Times: ISO 8601 UTC strings.

/** How a value was obtained. Shown in the UI; MOCK/MODELED never presented as OBSERVED. */
export type DataStatus = 'OBSERVED' | 'DERIVED' | 'MODELED' | 'MOCK'

export type DataType =
  | 'optical'
  | 'thermal'
  | 'spectral'
  | 'topographic'
  | 'atmospheric'
  | 'radiation'
  | 'chemical'
  | 'derived'

export interface Bounds {
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
}

/** A map layer. Exactly one of tileUrl / imageOverlay is set. */
export interface Layer {
  id: string
  name: string
  dataType: DataType
  /** XYZ/WMTS template, e.g. ".../{z}/{x}/{y}.png". */
  tileUrl?: string
  /** Single image stretched over `bounds` (path relative to data/). */
  imageOverlay?: string
  bounds: Bounds
  /** 0..1 */
  opacity: number
  attribution: string
  status: DataStatus
}

/** CostGrid.terrainClass codes. */
export const TERRAIN = {
  BEDROCK: 0,
  SAND: 1,
  BOULDERS: 2,
  NO_GO: 3,
} as const
export type TerrainClass = (typeof TERRAIN)[keyof typeof TERRAIN]

/**
 * Raster the route engine runs on. Row-major, row 0 = north edge (latMax),
 * column 0 = west edge (lonMin). Index = row * width + col.
 */
export interface CostGrid {
  width: number
  height: number
  cellSizeM: number
  bounds: Bounds
  /** meters, relative to the Mars areoid */
  elevation: Float32Array
  /** degrees, steepest slope of the cell (direction-free) */
  slopeDeg: Float32Array
  /** TerrainClass codes */
  terrainClass: Uint8Array
  status: DataStatus
}

/**
 * On-disk form of a CostGrid: `<name>.json` (this metadata) + `<name>.bin`.
 * The .bin is the three arrays concatenated, little-endian, no padding:
 *   elevation    Float32 × width·height
 *   slopeDeg     Float32 × width·height
 *   terrainClass Uint8   × width·height
 */
export interface CostGridMeta {
  width: number
  height: number
  cellSizeM: number
  bounds: Bounds
  /** .bin file name, relative to the .json */
  binary: string
  status: DataStatus
  /** Per-array status when they differ from `status` (e.g. elevation OBSERVED, slopeDeg DERIVED). */
  arrayStatus?: Partial<Record<'elevation' | 'slopeDeg' | 'terrainClass', DataStatus>>
  /** Human-readable provenance; full entry lives in data/SOURCES.md. */
  source: string
}

export type WaypointKind = 'base' | 'rover' | 'science' | 'via'

export interface Waypoint {
  id: string
  lat: number
  lon: number
  kind: WaypointKind
  name: string
}

export interface ScienceTarget {
  id: string
  lat: number
  lon: number
  name: string
  /** What to look at and why it matters. */
  why: string
  instrumentsNeeded: string[]
  source: string
  status: DataStatus
}

export interface PovImage {
  lat: number
  lon: number
  url: string
  thumbnailUrl: string
  source: string
  sol: number
  camera: string
  isPanorama: boolean
  /** Not in the original §5 list; added so mock images can be labeled MOCK. */
  status: DataStatus
}

export interface Conditions {
  time: string
  tempC: number
  pressurePa: number
  /** Column dust optical depth */
  dustTau: number
  sunElevationDeg: number
  radiationAlert: boolean
  source: string
  status: DataStatus
}

/** A rover's drive path through the site (e.g. Curiosity from JPL MMGIS), in drive order. */
export interface RoverTraverse {
  rover: string
  points: { sol: number; lat: number; lon: number }[]
  source: string
  status: DataStatus
}

/** Space weather around the planned sol (NASA DONKI): catalogued events, and the windows our rule turns into checks. */
export interface SpaceWeather {
  window: { start: string; end: string }
  events: { time: string; kind: 'cme-mars' | 'sep' | 'flare'; summary: string; atMars: boolean; link: string }[]
  /** 'alert' windows are also radiationAlert in the conditions (NO-GO); 'advisory' windows give a caution */
  windows: { start: string; end: string; level: 'alert' | 'advisory'; reason: string; link: string }[]
  source: string
  status: DataStatus
}

/** Shape of data/config.json. All paths are relative to data/. */
export interface DataConfig {
  site: {
    name: string
    bounds: Bounds
    /** Why these bounds; flags placeholder vs verified. */
    boundsNote: string
    boundsStatus: DataStatus
    /** Map zoom range. max = deepest TileMatrix of the base tiles (from their WMTSCapabilities). */
    zoom: { min: number; max: number }
  }
  /** Drawn bottom to top. Image overlays lie within the site; tile layers' bounds are their coverage. */
  layers: Layer[]
  /** Layer ids switched on when the app opens. */
  initialLayers: string[]
  /** Path to a CostGridMeta JSON. */
  costGrid: string
  /** JSON file holding ScienceTarget[] */
  scienceTargets: { path: string; status: DataStatus }
  /** JSON file holding PovImage[] */
  povImages: { path: string; status: DataStatus }
  /** JSON file holding Conditions[], a time series in time order */
  conditions: { path: string; status: DataStatus }
  /** JSON file holding Waypoint[]: the base and the rover's start position */
  waypoints: { path: string; status: DataStatus }
  /** Optional: JSON file holding a RoverTraverse, drawn on the map and compared with the plan */
  roverTraverse?: { path: string; status: DataStatus }
  /** Optional: JSON file holding SpaceWeather for the planned sol */
  spaceWeather?: { path: string; status: DataStatus }
}
