import L from 'leaflet'
import { MARS_EQUATORIAL_RADIUS_M } from '../config'

/**
 * Equirectangular Mars CRS. Leaflet's EPSG4326 tiling (2 x 1 tiles at z0, top-left -180/90) is identical to the
 * Mars Trek EQ tile matrix (see tiles.ts); only the planet radius changes, so the scale bar and distances are Martian.
 * Projection uses the equatorial radius (CLAUDE.md §5); route stats use the mean radius.
 */
export const MARS_CRS: L.CRS = L.Util.extend({}, L.CRS.EPSG4326, {
  code: 'IAU2000:49910', // Mars 2000, equidistant cylindrical, sphere
  R: MARS_EQUATORIAL_RADIUS_M,
})
