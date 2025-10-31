# uk-osmap-display-obsidian-plugin
This is a plugin for obsidian that takes a GPX file and display it on an OS Map base map, UK-centric Obsidian plugin that uses the Ordnance Survey (OS) Data Hub to display one or more GPX routes right inside your notes.

use a code block like
```

osmap
gpx:
  - [[Routes/peters-village-loop.gpx]]
style: Outdoor_3857
center: [51.338, 0.493]
zoom: 12
height: 600
showStartEnd: true
```

How to use

Get an OS Data Hub API key (free tier is fine).

Create a folder: <Vault>/.obsidian/plugins/uk-os-map-gpx/ and add the three files above.

In Obsidian: Settings → Community Plugins → Reload plugins → Enable UK OS Map (GPX).

Open Settings → UK OS Map (GPX) and paste your API key.

Put your GPX file(s) in your vault (e.g., Routes/peters-village-loop.gpx).

Add a block to a note:

```osmap
gpx:
  - [[Routes/peters-village-loop.gpx]]
  - [[Routes/medway-ridge.gpx]]
style: Outdoor_3857
center: [51.338, 0.493]   # Peter’s Village area
zoom: 12
height: 600
gpxColor: "#ff6600"
zoomFeatures: true
showStartEnd: true
legend: true
```
