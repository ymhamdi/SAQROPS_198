# Data sources and provenance

One entry per real dataset used by the app or pipeline (CLAUDE.md §4). Anything not listed here is `MOCK`.

Template:

```
## <Dataset name>
- Mission / instrument:
- Product ID:
- URL:
- Resolution:
- Coverage of site:
- License / credit:
- Date retrieved:
- Processing applied:
- Used as: <layer id / contract field>, status <OBSERVED|DERIVED>
```

---

## MRO HiRISE, Curiosity Roving Site Mosaic (via NASA Mars Trek)
- Mission / instrument: Mars Reconnaissance Orbiter (MRO) / High Resolution Imaging Science Experiment (HiRISE)
- Product ID: Mars Trek layer `curiosity_hirise_mosaic` ("MRO HiRISE, Curiosity Roving Site Mosaic")
- URL: https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml
- Tiles: `https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0//default/default028mm/{z}/{y}/{x}.png` (ResourceURL template from GetCapabilities; Style `default`, TileMatrixSet `default028mm`)
- Resolution: TileMatrix 0-16, 256 px tiles, equirectangular, top-left -180/90, 2^(z+1) x 2^z tiles; level 16 = ~0.64 m/pixel in this tiling (HiRISE native ~0.25-0.5 m/pixel)
- Coverage of site: yes. Layer bbox lon 137.1224669-137.7298129, lat -4.9254743 to -4.2489588; sample tiles at (-4.80, 137.38) for z12/z14/z16 contain imagery
- License / credit: NASA/JPL-Caltech/University of Arizona; served by NASA Mars Trek (JPL)
- Date retrieved: 2026-10-30 (tiles are fetched live by the app)
- Processing applied: none; displayed as served
- Used as: layer `hirise`, status OBSERVED

## USGS MSL Gale Merged DEM 1m v3 (Mars Trek layer `Gale_DEM_SMG_1m`)
- Mission / instrument: MRO HiRISE, MRO CTX and Mars Express HRSC stereo DEMs, tied to MGS MOLA; merged by USGS Astrogeology (T. Parker, F. J. Calef III, 2016)
- Product ID: `MSL_Gale_DEM_Mosaic_1m_v3.tif` ("Mars MSL Gale Merged DEM 1m"); shown on NASA Mars Trek as `Gale_DEM_SMG_1m` (official resource 1)
- URL: https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif (product page https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m)
- Resolution: 1 m posting; float32 metres, nodata -32767; equirectangular (eqc, lon_0 0, R 3396190 m); 32980 x 57440 px. Effective resolution coarser than 1 m (stereo noise): slope at 1 m overstates steepness, so the app uses 2 m cells.
- Coverage of site: yes, whole site box, no nodata; real metre-scale relief at the boxwork (checked 2026-11-14, docs/resources.md)
- License / credit: USGS Astrogeology Science Center / NASA; HiRISE NASA/JPL-Caltech/University of Arizona; CTX NASA/JPL-Caltech/MSSS; HRSC ESA/DLR/FU Berlin
- Date retrieved: 2026-11-14 (only the site rows, read over HTTP with GDAL /vsicurl/)
- Processing applied: `python -m pipeline gale-dem` → site box + 100 m margin copied unchanged to `data/raw/gale_dem_1m_site.tif`; `pipeline/build.py` warps it bilinearly onto 2 m square cells in Mars geographic coordinates (R 3396190 m, the app's map sphere), Horn slope with the true 2 m cell size, hillshade (sun NW 45°). Sand and boulder classes come from the HiRISE orthophoto (next entry; terrainClass MODELED); cells without elevation would be NO_GO (none in this box).
- Used as: CostGrid `processed/gale/costgrid.json` (elevation, slopeDeg DERIVED; terrainClass MODELED), status DERIVED
- Used as: layer `hillshade`, status DERIVED

## USGS MSL Gale Merged Orthophoto Mosaic 25cm v3 → sand and boulder classes
- Mission / instrument: MRO HiRISE orthophotos merged by USGS Astrogeology (same project as the Gale DEM)
- Product ID: `MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif` ("Mars MSL Gale Merged Orthophoto Mosaic 25cm"), official resource 2 (USGS)
- URL: https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif (product page https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- Resolution: 0.25 m; 8-bit; eqc on R 3396190 m (as the DEM); 180000 x 280000 px
- Coverage of site: yes (no gaps)
- License / credit: USGS Astrogeology Science Center / NASA; HiRISE NASA/JPL-Caltech/University of Arizona
- Date retrieved: 2026-11-14 (site + 20 m read over HTTP, 8188 x 8160 px, `data/raw/gale_ortho_25cm_site.tif`)
- Processing applied: `python -m pipeline gale-surface` (pipeline/surface.py). Warped (nearest) onto the CostGrid cells at 0.25 m (8 x 8 per 2 m cell). Per cell: brightness, and speckle = std of the 0.25 m samples. Sand = speckle in the lowest 35% of the site AND darker than the mean of the surrounding 22 m AND slope < 15°, in patches (>= 5 of 3 x 3 cells): smooth, dark hollow floors (Gale's sand is dark; the mission blog says hollow floors are "often covered by sand and pebbles"). Boulders = speckle in the top 2%, not sand, clusters >= 4 of 3 x 3 (rocky ledges and blocks, mostly on already-steep cliff edges). Result: sand 6.5%, boulders 0.9% of the site. DEM local relief was tried for "hollow" and dropped (DEM too smooth for 1-2 m ridges). Checks: no science stop is on sand (Valle de la Luna, drilled because its hollow floor was bare bedrock, has 2% sand within 10 m); against THEMIS night IR, the warmest third of walkable ground has 5.8% sand vs 8.7-9.1% for the cooler two thirds (weak, right direction; cell correlation -0.06 at 100 m vs 2 m).
- Used as: CostGrid `terrainClass` (SAND, BOULDERS) via `build --sand/--boulders`, status MODELED

## Curiosity REMS daily weather report, sol 4718 → planned-sol conditions
- Mission / instrument: Mars Science Laboratory, Curiosity / Rover Environmental Monitoring Station (REMS; Centro de Astrobiología CSIC-INTA, Spain)
- Product ID: NASA "Mars Weather" feed, MSL category, report for sol 4718 (2025-11-13): air -74 to -5 °C, 695 Pa, opacity "Sunny", sunrise 05:22, sunset 17:20 (local mean solar time)
- URL: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
- Resolution: one report per sol (daily min/max); no hourly values, no numeric dust opacity, no radiation
- Coverage of site: yes; Curiosity was parked at Nevado Sajama, inside the site, on sol 4718 (the day it drilled there)
- License / credit: NASA/JPL-Caltech/CAB(CSIC-INTA)
- Date retrieved: 2026-11-14
- Processing applied: `python -m pipeline msl-weather` (pipeline/sources/msl_weather.py). 25 samples, one per Mars hour, from local mean midnight at the habitat (Mars24 time scale; sol numbered from Curiosity's landing, 2012-08-06T05:17:57Z): 2025-11-13T06:43:30Z to 2025-11-14T07:23:06Z. Temperature: reported minimum at the reported sunrise, maximum at 13:30 local, half-cosine between (shape MODELED). Pressure: the reported value all sol (no diurnal cycle). Dust opacity 0.6 assumed for "Sunny" (MODELED). Radiation alert false (no public alert data; MODELED). Sun elevation in the file is approximate; the app recomputes it with its Mars24 clock (DERIVED). Checks: the app's Mars24 sunrise 05:23:00 and sunset 17:20:26 local mean time match the report's 05:22 / 17:20; Curiosity's sol-4718 Front Hazcam frame (20:17:38Z) falls inside the window.
- Used as: `processed/gale/conditions.json` (Conditions[]), status MODELED (each sample mixes measured and assumed values; its `source` says which)

## NASA DONKI space weather around sol 4718
- Mission / instrument: NASA Community Coordinated Modeling Center (CCMC) DONKI database: WSA-Enlil CME simulations (model) and solar energetic particle events (spacecraft near Earth, STEREO-A)
- Product ID: DONKI `WSAEnlilSimulations` 2025-11-06 to 2025-11-14 and `SEP` 2025-11-10 to 2025-11-15; the Mars impact: simulation WSA-ENLIL/42563 (run 2025-11-10T02:34Z) for CME 2025-11-09T21:12:00-CME-001 (975 km/s), arrival at Mars 2025-11-13T04:00Z, direct, minor impact
- URL: https://api.nasa.gov/DONKI/ (key: NASA_API_KEY or the public DEMO_KEY); event pages https://ccmc.gsfc.nasa.gov/DONKI/
- Resolution: event catalogue; forecast arrival times (typical error about half a day)
- Coverage of site: Mars-wide (arrival at Mars); SEP events are near Earth / STEREO-A, not at Mars (listed as context only)
- License / credit: NASA CCMC / DONKI
- Date retrieved: 2026-11-14 (flare endpoint returned 404 that day; flares not used)
- Processing applied: `python -m pipeline donki`. Mars impacts from WSA-Enlil runs, one per arrival time (earliest run). Rule (MODELED): direct non-minor arrival = radiation ALERT (written into the conditions as radiationAlert by `msl-weather`, NO-GO); minor or glancing = ADVISORY (caution), each for arrival ± 12 h. Result for sol 4718: one ADVISORY, 2025-11-12T16:00Z to 2025-11-13T16:00Z; no alerts.
- Used as: `processed/gale/space_weather.json` (SpaceWeather), status MODELED; radiationAlert in `processed/gale/conditions.json`

## Curiosity boxwork campaign: traverse and science stops
- Mission / instrument: Mars Science Laboratory, Curiosity rover (NASA/JPL-Caltech). Positions from the rover's localized drive end-points; science from the mission blog and JPL news.
- Product ID: MMGIS layer "Waypoints" (`MSL_waypoints.json`, 1389 points, sol 3-5073 at retrieval)
- URL: https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json (MMGIS map: https://mars.nasa.gov/maps/location/?mission=MSL). Reports cited per stop in `pipeline/sources/msl_boxwork_targets.json`: JPL news 2025-06-23 and 2026-02-23; Curiosity blog posts for sols 4561-4562, 4689-4694, 4709-4715, 4716-4722, 4804-4811 (science.nasa.gov/blog).
- Resolution: one point per drive; positions to about a metre
- Coverage of site: yes; the 2025-26 boxwork campaign (sols ~4541-4841) lies inside the site
- License / credit: NASA/JPL-Caltech
- Date retrieved: 2026-11-14
- Processing applied: `python -m pipeline msl-targets`. 7 curated stops (first ridge close-up, Altadena drill, nodules, panorama viewpoint, Valle de la Luna hollow drill, Nevado Sajama ridge drill, final-phase workspace), each placed at the last waypoint on or before its sol. Earth dates converted to sols from the blog's own pairs (sol 4560 = 2025-06-04, sol 4718 = 2025-11-13). A stop the habitat cannot reach on foot moves to the nearest reachable cell within 20 m and says so (nodules: 3 m off a 36° ridge wall); none dropped. `why` texts paraphrase the reports; crew kit is our MODELED choice.
- Used as: `processed/gale/science_targets.json` (ScienceTarget[]), status DERIVED
- Used as: `processed/gale/curiosity_traverse.json` (RoverTraverse: the 143 waypoints inside the site, sols 4462-4983, 3.8 km; `python -m pipeline msl-traverse`), status OBSERVED: drawn on the map and compared with the plan's stops

## Curiosity raw images at the science stops (Navcam, Front Hazcam)
- Mission / instrument: Mars Science Laboratory, Curiosity rover: left Navcam (NAV_LEFT_B) and left Front Hazcam (FHAZ_LEFT_B), engineering cameras (NASA/JPL-Caltech)
- Product ID: raw image ids listed per image in `processed/gale/pov_images.json` (e.g. NLB_813579644EDR_F1191722NCAM00259M); 21 Navcam + 3 Front Hazcam frames
- URL: https://mars.nasa.gov/msl/multimedia/raw-images/ (JSON API https://mars.nasa.gov/api/v1/raw_image_items/); each image links to its page https://mars.nasa.gov/raw_images/<id>
- Resolution: originals 1024 x 1024 px grayscale JPEG; app copies 768 px (thumbnails 240 px)
- Coverage of site: yes; every image was taken at a stop's own rover position (site/drive in the image id = the MMGIS waypoint)
- License / credit: NASA/JPL-Caltech (credit line as given by the raw-image API)
- Date retrieved: 2026-11-14
- Processing applied: `python -m pipeline msl-images`. Per stop: left-Navcam full frames from the arrival sol with mast elevation -25° to -5° (looking out over the terrain), views within 35° of straight back over the rover deck skipped, up to 3 spread around the compass; plus the latest Front Hazcam full frame of the drill workspace on `workspaceSol` (Altadena 4568, Valle de la Luna 4693, Nevado Sajama 4718). Resized with averaging, JPEG quality 85; no other change. Viewing direction = waypoint yaw + mast azimuth (approximate; checked once against the DEM horizon at sol 4671).
- Used as: `processed/gale/pov_images.json` (PovImage[], isPanorama false), status OBSERVED

## THEMIS night-time infrared, controlled global mosaic 100 m (via NASA Mars Trek)
- Mission / instrument: 2001 Mars Odyssey / Thermal Emission Imaging System (THEMIS), night-time infrared; controlled mosaic (Arizona State University / USGS)
- Product ID: Mars Trek layer `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`
- URL: https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml (tiles `.../1.0.0//default/default028mm/{z}/{row}/{col}.png`)
- Resolution: 100 m mosaic; deepest TileMatrix 9 (~81 m per tile pixel); 24.6 tile pixels across the 2 km site
- Coverage of site: yes (mosaic covers latitudes -65° to 65°)
- License / credit: NASA/JPL-Caltech/Arizona State University; served by NASA Mars Trek (JPL)
- Date retrieved: 2026-11-14
- Processing applied: `python -m pipeline themis-night-ir` (pipeline/sources/trek_overlay.py). Level-9 tile pixels sampled nearest (no smoothing) onto a 500 x 500 px image exactly covering the site; grey values (Trek's display stretch, 142-215 inside the site) stretched between their 2nd and 98th percentile and coloured cool (dark blue) to warm (yellow). Relative only: warm at night = material that keeps its heat (rock, high thermal inertia), cool = sand or dust. Too coarse for 2 m hollows; regional context.
- Used as: layer `themis-night-ir`, status OBSERVED

## MRO CRISM mineral summary parameters (FRT0000B6F1)
- Mission / instrument: Mars Reconnaissance Orbiter, CRISM (Compact Reconnaissance Imaging Spectrometer for Mars), NASA/JPL-Caltech/JHUAPL
- Product ID: `FRT0000B6F1_07_SU165J_MTR3` (MTRDR, map-projected targeted reduced data record, summary parameters; observation 2008-07-09)
- URL: https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/2008/2008_191/frt0000b6f1/ (found with the PDS Orbital Data Explorer, https://ode.rsl.wustl.edu/mars/)
- Resolution: 18 m pixels; shown smoothed to ~90 m
- Coverage of site: whole site. Five CRISM MTRDR observations touch the site box; three cover it all (FRT000058A3, FRT0000B6F1 at 18 m; HRL0000BABA at 36 m); FRT0000B6F1 has the clearest hydration and sulfate signals over the site (checked 2026-11-15). This is outside the official Resources tab list (Mars Trek's CRISM mosaics do not cover the site), but it is NASA's own archive.
- License / credit: NASA/JPL-Caltech/JHUAPL, public domain (NASA data)
- Date retrieved: 2026-11-15
- Processing applied: `python -m pipeline crism` (pipeline/sources/crism.py). Two of the 60 summary-parameter bands, read by HTTP byte range (Viviano-Beck et al. 2014 definitions): BD1900R2 (1.9 µm water band depth: hydrated minerals) and OLINDEX3 (olivine index). Per-column striping removed (each column moved to the scene median), 5 x 5 box mean, bilinear sampling onto the site (500 px). Only the strongest quarter of each signal shows: from its site 75th percentile (transparent) to its 98th (full); a pixel takes the colour of the stronger one (blue water-bearing, green olivine). Per-pixel values at the site are close to CRISM's noise (BD1900R2 site p2/p50/p98 after smoothing -0.0007 / 0.0052 / 0.0111; OLINDEX3 0.029 / 0.050 / 0.073), so the layer is relative and regional, not a detection map or abundances. Checks: the 770 nm brightness band lines up with the HiRISE terrain; olivine is strongest along the dark basaltic-sand band across the site (correlation with 770 nm brightness -0.45); it matches the 2 m sand map of the hollows only weakly (7.9 % sand in its top quarter vs 6.5 % site-wide): the hollows are far smaller than 90 m. Clay indices (D2300, MIN2200) are negative over the site: no clay signal. The sulfate index (SINDEX2) is positive but too noisy to show.
- Used as: layer `crism-minerals`, status DERIVED

## 360° views at the stations (rendered, not photos)
- Mission / instrument: none of their own; computed from the USGS Gale DEM (elevation) and the USGS Gale 25 cm orthophoto (ground brightness), both listed above
- Product ID: `processed/gale/pov/pano_<station>.jpg`, one at the habitat and one at each science stop (8)
- URL: generated by `python -m pipeline gale-panoramas` (pipeline/sources/gale_panoramas.py + pipeline/panorama.py)
- Resolution: 1024 x 256 px equirectangular, 90° vertical field, column 0 = north; terrain at 2 m cells
- Coverage of site: the 2 km site only; terrain beyond it is not modelled and shows as haze
- License / credit: derived from USGS Astrogeology / NASA products (credits above)
- Date retrieved: 2026-11-14 (rendered)
- Processing applied: ray-marched from 1.7 m eye height at each station up to 3 km; ground painted with the orthophoto brightness per 2 m cell (1st-99th percentile stretch) times a light warm tint (display choice); butterscotch sky gradient and distance haze from pipeline/panorama.py. Checked: at the panorama stop the rendered butte and mesa sit in the NE/E, where Curiosity's NE-facing Navcam frame shows them.
- Used as: `processed/gale/pov_images.json` entries with isPanorama true, status DERIVED

No dataset in the app is MOCK. The one MOCK feature is the tablet's demo position fix ("Get real position", `app/src/localize/getRealPosition.ts`): a simulated drift from the planned position, with no measurement behind it, labelled MOCK in the UI. The way back to the route it triggers is planned on the real terrain grid above. Assumptions (walking model, O₂ budget, safety limits, habitat placement, terrain-class rules, dust opacity) are labelled MODELED.
