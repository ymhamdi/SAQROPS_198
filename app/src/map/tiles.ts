// Tile maths of the Mars Trek equirectangular WMTS tile matrix set "default028mm", as read from the
// layers' WMTSCapabilities.xml (e.g. trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml):
// TopLeftCorner (-180, 90), 256 px tiles, MatrixWidth x MatrixHeight = 2^(z+1) x 2^z, i.e. 180/2^z degrees per tile.
// This is exactly Leaflet's L.CRS.EPSG4326 tiling, which the Mars CRS reuses (see crs.ts).

export const TILE_SIZE = 256

export function tileDegrees(z: number): number {
  return 180 / 2 ** z
}

/** WMTS TileRow / TileCol containing (lat, lon) at TileMatrix z. */
export function tileAt(lat: number, lon: number, z: number): { row: number; col: number } {
  const deg = tileDegrees(z)
  return { row: Math.floor((90 - lat) / deg), col: Math.floor((lon + 180) / deg) }
}

/** Ground size of one pixel at zoom z along a meridian, m (equirectangular, equatorial radius). */
export function metresPerPixel(z: number, metresPerDegree: number): number {
  return (tileDegrees(z) * metresPerDegree) / TILE_SIZE
}
