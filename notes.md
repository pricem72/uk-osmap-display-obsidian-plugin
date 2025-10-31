Supported options (per block)

gpx: a single wikilink or a list ([[path.gpx]]), multiple tracks supported

style: Outdoor_3857 | Leisure_3857 | Road_3857 | Light_3857 | Backdrop_3857

center: [lat, lon] (defaults to UK center)

zoom: number (default from settings)

height: px height of the map container

gpxColor: any CSS color for the route line

zoomFeatures/fit: true to auto-fit to GPX bounds

showStartEnd: true|false to toggle start/end dots

legend: true|false to toggle the little legend card

apiKey: override (optional; otherwise uses plugin settings)

Notes & nice-to-haves

This uses OS raster ZXY tiles (Web Mercator 3857), which play nicely with Leaflet.

If you later want vector tiles (OS Vector Tile API) and hillshading/contours, I can extend this to MapLibre-GL and draw GPX as GeoJSON with elevation popups.

The GPX parser here is lightweight (tracks only). If you want full GPX (routes, waypoints, elevation stats), I can swap in togeojson and add elevation/grade stats in a sidebar.
