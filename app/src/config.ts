// Constants and thresholds. Each one carries its source and status.
// MODELED = assumption we chose; tune when the official resources (Nov 13) give better numbers.
// Mirror any value the pipeline also needs in pipeline/config.py.

import { TERRAIN, type TerrainClass } from './types'

// ---------- Mars physical constants ----------

/** Volumetric mean radius, m. Use for distances along the surface (haversine). Source: NASA GSFC Mars Fact Sheet. */
export const MARS_MEAN_RADIUS_M = 3_389_500

/** Equatorial radius, m. Use for the map projection (equirectangular CRS). Source: IAU / MOLA reference, NASA GSFC Mars Fact Sheet. */
export const MARS_EQUATORIAL_RADIUS_M = 3_396_190

/** Meters per degree of latitude in the map projection. Derived from MARS_EQUATORIAL_RADIUS_M. */
export const METERS_PER_DEG_LAT = (2 * Math.PI * MARS_EQUATORIAL_RADIUS_M) / 360

/** Surface gravity, m/s². Source: NASA GSFC Mars Fact Sheet. */
export const MARS_GRAVITY_MS2 = 3.721

// ---------- Walking speed (Tobler's hiking function) ----------
// v = TOBLER_MAX_SPEED_KMH · exp(−TOBLER_DECAY · |tanθ + TOBLER_SLOPE_OFFSET|) · SUIT_SPEED_FACTOR
// Source: Tobler, W. (1993), "Three presentations on geographical analysis and modeling", NCGIA TR 93-1.

/** Peak walking speed on Earth, km/h (reached on a 5% downhill). Source: Tobler 1993. */
export const TOBLER_MAX_SPEED_KMH = 6

/** Exponential decay with slope. Source: Tobler 1993. */
export const TOBLER_DECAY = 3.5

/** Downhill offset of the fastest gradient (tanθ = −0.05). Source: Tobler 1993. */
export const TOBLER_SLOPE_OFFSET = 0.05

/**
 * Speed multiplier for a suited astronaut carrying equipment. MODELED: team assumption
 * (CLAUDE.md §5 default). Suit mass, joint stiffness and the 0.38 g gait are not in Tobler's data.
 */
export const SUIT_SPEED_FACTOR = 0.6

// ---------- Trafficability ----------

/** Slope above which walking cost is penalized, degrees. MODELED: team assumption (CLAUDE.md §5). */
export const SLOPE_PENALTY_START_DEG = 15

/** Slope at or above which a cell is impassable on foot, degrees. MODELED: team assumption (CLAUDE.md §5). */
export const SLOPE_IMPASSABLE_DEG = 25

/**
 * Extra cost per degree above SLOPE_PENALTY_START_DEG, as a fraction of base cost
 * (cost × (1 + k·(θ − start))). 0.2 → ×3 at 25°. MODELED: team assumption.
 */
export const SLOPE_PENALTY_PER_DEG = 0.2

/** Cost multiplier per terrain class. Infinity = impassable. MODELED: team assumption (CLAUDE.md §5). */
export const TERRAIN_COST_MULTIPLIER: Record<TerrainClass, number> = {
  [TERRAIN.BEDROCK]: 1,
  [TERRAIN.SAND]: 2, // loose sand in boxwork hollows: wheel slip for Curiosity, slow footing for crew
  [TERRAIN.BOULDERS]: 4,
  [TERRAIN.NO_GO]: Infinity,
}

// ---------- "Safest" route alternative ----------
// The safest route is searched with these heavier penalties, so it detours around hazards when it can; its time
// is then reported with the normal walking model above, so both options are compared on the same clock.

/** Search-cost multipliers for the safest route. MODELED: team assumption. */
export const SAFE_ROUTE_TERRAIN_MULTIPLIER: Record<TerrainClass, number> = {
  [TERRAIN.BEDROCK]: 1,
  [TERRAIN.SAND]: 6,
  [TERRAIN.BOULDERS]: 12,
  [TERRAIN.NO_GO]: Infinity,
}

/** Extra search cost per degree above the penalty start for the safest route (×7 at 25°). MODELED: team assumption. */
export const SAFE_ROUTE_SLOPE_PENALTY_PER_DEG = 0.6

/**
 * The safest route is the default. The fastest one is offered as an alternative only when it saves at least this
 * many minutes; below that the safe route costs nothing worth choosing against. Team UX choice.
 */
export const FASTER_ALTERNATIVE_MIN_SAVING_MIN = 5

// ---------- Life support and EVA timeline ----------

/**
 * Usable suit O2 for one EVA, minutes. MODELED: assumption based on the ~8 h EVA
 * design target of NASA's xEMU / Artemis surface suits. Replace with resource docs if given.
 */
export const SUIT_O2_DURATION_MIN = 480

/** O2 that must still remain on arrival back at base, minutes. MODELED: team assumption. */
export const O2_RESERVE_MIN = 30

/** Default time spent working at each science stop, minutes. MODELED: team assumption. */
export const SCIENCE_STOP_DWELL_MIN = 20

/** Crew must be back at base this long before local sunset, minutes. MODELED: team assumption. */
export const SUNSET_MARGIN_MIN = 30

/**
 * Emergency walk home is assumed this much slower than a planned walk (fatigue, suit fault,
 * helping a partner). Drives the point-of-no-return check. MODELED: team assumption.
 */
export const WALK_HOME_CONTINGENCY_FACTOR = 1.5

// ---------- Radiation ----------

/**
 * Baseline surface dose equivalent at Gale Crater, mSv/day. OBSERVED: Curiosity RAD,
 * Hassler et al. (2014), Science 343, 1244797 (0.64 ± 0.12 mSv/day).
 */
export const RAD_BASELINE_DOSE_MSV_PER_DAY = 0.64

// ---------- Radio line of sight ----------
// A suited crew member is "in contact" when there is a straight, unobstructed line from the helmet antenna to the
// habitat mast or to the staged rover's antenna. Direct line of sight only: no relay via orbiters or diffraction, so
// this is conservative. All heights MODELED: team assumptions.

/** Habitat radio mast height above the ground, m. */
export const HABITAT_ANTENNA_HEIGHT_M = 5

/** Support rover antenna height above the ground, m. */
export const ROVER_ANTENNA_HEIGHT_M = 3

/** Suit (helmet) antenna height above the ground, m. */
export const SUIT_ANTENNA_HEIGHT_M = 1.8

/** Out of line of sight for at least this long in total → a caution, minutes. */
export const COMMS_CAUTION_MIN = 1

// ---------- Simulated position fix (localize/getRealPosition.ts) ----------
// MOCK: demo stand-in for a real localization system (e.g. a 360° stereo view matched to the HiRISE map). No real
// measurement is made; these numbers only shape the simulated drift.

/** Simulated drift between where the plan puts the crew and where the fix says they are, m (min, max). MOCK. */
export const SIMULATED_FIX_OFFSET_M: readonly [number, number] = [15, 40]

/** Simulated time to get a fix, ms, so the demo shows a "locating" step. MOCK. */
export const SIMULATED_FIX_DELAY_MS = 1200

/** Simulated fix accuracy shown with the result, m. MOCK (the published rover method reports ~0.25 m). */
export const SIMULATED_FIX_ACCURACY_M = 0.25
// ---------- Rover-assisted Marswalk ("ride and walk") ----------
// The support rover drives the crew from the habitat to a drop-off point by the first stop and back from a pick-up
// point by the last stop. An unpressurized rover, like NASA's Artemis LTV concept: the crew stays suited, so suit O2
// keeps counting while riding. All MODELED: team assumptions, not a vehicle specification.

/** Planned driving speed over rough terrain, km/h. */
export const ROVER_SPEED_KMH = 6

/** Slope above which the rover slows, degrees. */
export const ROVER_SLOPE_PENALTY_START_DEG = 10

/**
 * Slope at or above which the rover cannot drive, degrees: the slope Apollo's Lunar Roving Vehicle was designed to
 * climb. On this site the only way out of the habitat floor crosses 20-25° ground, so a 20° limit traps the rover.
 */
export const ROVER_SLOPE_IMPASSABLE_DEG = 25

/** Extra cost per degree above the rover's penalty start (cost × (1 + k·(θ − start))). */
export const ROVER_SLOPE_PENALTY_PER_DEG = 0.1

/** Rover cost per terrain class: sand slows it (wheel slip, Curiosity's lesson); rocky ground is off limits. */
export const ROVER_TERRAIN_MULTIPLIER: Record<TerrainClass, number> = {
  [TERRAIN.BEDROCK]: 1,
  [TERRAIN.SAND]: 3,
  [TERRAIN.BOULDERS]: Infinity,
  [TERRAIN.NO_GO]: Infinity,
}

/** The rover parks at the rover-reachable cell nearest each stop, within this, m; farther stops are walked to. (MODELED) */
export const ROVER_DROP_MAX_DISTANCE_M = 400

/**
 * Getting on and off the rover is not timed by the walking model, so a leg is ridden only when riding saves at least
 * this much over walking it, s. Also stops the planner from hopping in for a few metres. (MODELED)
 */
export const ROVER_BOARDING_S = 120


// ---------- Mission control (panels/MissionControl.tsx, route/reroute.ts) ----------

/**
 * A change sent while the crew walks starts this many route cells (~2 m each) ahead of them on the leg they are on,
 * so they never have to turn back to reach the new path. MODELED: team assumption.
 */
export const CONTROL_LEAD_CELLS = 10
