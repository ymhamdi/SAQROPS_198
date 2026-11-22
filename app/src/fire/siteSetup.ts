// The fire engine's view of the site: room geometry, doors (exits included, outside = -1) and detectors.

import type { Site } from '../site/site.ts'
import type { FireSetup } from './engine.ts'

export function fireSetupOf(site: Site): FireSetup {
  return {
    rooms: site.rooms.map((r) => ({
      floorM2: r.floorM2,
      heightM: r.heightM,
      surfaceM2: r.surfaceM2,
      walls: r.walls,
      flashoverModel: r.flashoverModel,
      growth: r.growth,
      curve: null,
    })),
    doors: site.doors.map((d) => ({ rooms: d.rooms, widthM: d.widthM, heightM: d.heightM, at: d.centre })),
    detectors: site.detectors.map((d) => ({ room: d.room, at: d.at })),
  }
}

/** Initial door states as drawn on the plan (exits open). */
export function initialDoors(site: Site): boolean[] {
  return site.doors.map((d) => d.initiallyOpen)
}
