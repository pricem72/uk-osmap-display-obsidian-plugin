import { App, MarkdownPostProcessorContext, MarkdownRenderChild, Plugin, PluginSettingTab, Setting, TFile, Notice } from "obsidian";
import L from "leaflet";

// Minimal Leaflet CSS injection (so users don't need extra imports)
const LEAFLET_CSS = `
/* Leaflet core */
.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,
.leaflet-pane > svg,.leaflet-pane > canvas,.leaflet-zoom-box,.leaflet-image-layer,.leaflet-layer,
.leaflet-overlay-pane svg,.leaflet-marker-pane img,.leaflet-shadow-pane img,.leaflet-tile-pane img,
.leaflet-pane canvas, .leaflet-zoom-animated { position:absolute; left:0; top:0; }
.leaflet-container { overflow: hidden; -webkit-tap-highlight-color: transparent; }
.leaflet-control { position: relative; z-index: 800; pointer-events: auto; }
.leaflet-top, .leaflet-bottom { position: absolute; z-index: 1000; pointer-events: none; }
.leaflet-top { top: 0; } .leaflet-right { right: 0; } .leaflet-bottom { bottom: 0; } .leaflet-left { left: 0; }
.leaflet-control-zoom { pointer-events: auto; }
.leaflet-control-zoom a { text-decoration: none; }
.leaflet-control-zoom a, .leaflet-control-layers-toggle { cursor: pointer; }
.leaflet-container a { color: inherit; }
`;

// ---------------- Settings ----------------
interface OSPluginSettings {
  osApiKey: string;
  defaultStyle: OSStyleKey;
  defaultCenter: [number, number];
  defaultZoom: number;
}

type OSStyleKey =
  | "Outdoor_3857"
  | "Leisure_3857"
  | "Road_3857"
  | "Light_3857"
  | "Backdrop_3857";

const DEFAULT_SETTINGS: OSPluginSettings = {
  osApiKey: "",
  defaultStyle: "Outdoor_3857",
  defaultCenter: [54.5, -3.0], // UK-ish center
  defaultZoom: 6
};

// OS Raster ZXY endpoint
function osRasterUrl(style: OSStyleKey, apiKey: string) {
  return `https://api.os.uk/maps/raster/v1/zxy/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(apiKey)}`;
}

export default class UKOSMapPlugin extends Plugin {
  settings: OSPluginSettings;

  async onload() {
    console.log("Loading UK OS Map (GPX) plugin…");
    await this.loadSettings();

    // Inject minimal Leaflet CSS (kept inline to avoid extra bundling steps)
    this.injectCss(LEAFLET_CSS);

    this.registerMarkdownCodeBlockProcessor("osmap", (source, el, ctx) =>
      this.renderOSMapBlock(source, el, ctx)
    );

    this.addSettingTab(new OSSettingsTab(this.app, this));
  }

  onunload() {
    console.log("Unloading UK OS Map (GPX) plugin.");
  }

  private injectCss(css: string) {
    const style = document.createElement("style");
    style.setAttribute("uk-osmap-inline", "true");
    style.textContent = css;
    document.head.appendChild(style);
    this.register(() => style.remove());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ------------- Block processor -------------
  async renderOSMapBlock(source: string, container: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const opts = this.parseYamlLike(source);

    const height = Number(opts.height ?? 480);
    const target = container.createDiv({ cls: "uk-osmap" });
    target.style.height = `${height}px`;

    // Read options
    const style: OSStyleKey = (opts.style ?? this.settings.defaultStyle) as OSStyleKey;
    const apiKey = (opts.apiKey ?? this.settings.osApiKey) as string;
    const zoom = Number(opts.zoom ?? this.settings.defaultZoom);
    const center = (opts.center ?? this.settings.defaultCenter) as [number, number];
    const showStartEnd = Boolean(opts.showStartEnd ?? true);
    const fitToData = opts.zoomFeatures === true || opts.fit === true;

    if (!apiKey) {
      new Notice("UK OS Map: Please set your OS Data Hub API key in the plugin settings.");
      target.createEl("div", { text: "OS API key missing. Open Settings → UK OS Map (GPX)." });
      return;
    }

    // Create map
    const map = L.map(target, {
      zoomControl: true,
      attributionControl: true
    });

    // Add OS base layer
    const tileUrl = osRasterUrl(style, apiKey);
    const tiles = L.tileLayer(tileUrl, {
      maxZoom: 20,
      attribution:
        '© Ordnance Survey. Contains OS data © Crown copyright and database rights.'
    });
    tiles.addTo(map);

    map.setView(L.latLng(center[0], center[1]), zoom);

    // Add GPX routes
    const gpxInputs: string[] = Array.isArray(opts.gpx) ? opts.gpx : (opts.gpx ? [opts.gpx] : []);
    const color = (opts.gpxColor ?? "#ff6600") as string;

    const group = L.featureGroup().addTo(map);

    // Load each GPX reference
    for (const ref of gpxInputs) {
      try {
        const tfile = this.resolveLink(ref, ctx.sourcePath);
        if (!tfile) {
          console.warn(`UK OS Map: GPX not found: ${ref}`);
          continue;
        }
        const text = await this.app.vault.read(tfile);
        const poly = this.gpxToPolyline(text, { color });
        if (poly) {
          poly.addTo(group);

          if (showStartEnd) {
            const latlngs = (poly as any).getLatLngs() as L.LatLng[];
            if (latlngs.length > 0) {
              L.circleMarker(latlngs[0], { radius: 5 }).bindTooltip("Start").addTo(group);
              L.circleMarker(latlngs[latlngs.length - 1], { radius: 5 }).bindTooltip("End").addTo(group);
            }
          }
        }
      } catch (e) {
        console.error("UK OS Map: Error loading GPX", ref, e);
      }
    }

    if (fitToData && (group as any).getLayers().length > 0) {
      map.fitBounds(group.getBounds(), { padding: [16, 16] });
    }

    // Optional minimal legend
    if (opts.legend !== false) {
      const legend = target.createDiv({ cls: "os-legend" });
      legend.innerHTML = `
        <div><strong>OS style:</strong> ${style.replace("_3857","")}</div>
        <div><span style="display:inline-block;width:12px;height:2px;vertical-align:middle;background:${color};margin-right:6px;"></span>GPX Track</div>
      `;
    }

    // Make sure map resizes correctly when note pane changes
    const child = new ResizeWatcher(target, () => map.invalidateSize());
    this.registerDomEvent(window, "resize", () => map.invalidateSize());
    this.register(() => child.unload());
  }

  // ------------- Helpers -------------
  /**
   * Lightweight YAML-ish parser for key: value lines and simple arrays.
   * Supports:
   * key: value
   * key:
   *   - item1
   *   - item2
   */
  private parseYamlLike(src: string): Record<string, any> {
    const lines = src.split(/\r?\n/);
    const out: Record<string, any> = {};
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trimEnd();
      i++;
      if (!line || line.trimStart().startsWith("#")) continue;
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2];

      if (val === "" && i < lines.length && lines[i].match(/^\s*-\s+/)) {
        // array block
        const arr: string[] = [];
        while (i < lines.length) {
          const lm = lines[i].match(/^\s*-\s+(.*)$/);
          if (!lm) break;
          arr.push(lm[1].trim());
          i++;
        }
        out[key] = arr;
      } else if (/^\[.*\]$/.test(val.trim())) {
        // simple [lat, lon]
        try {
          out[key] = JSON.parse(val.replace(/'/g, '"'));
        } catch {
          out[key] = val;
        }
      } else if (val === "true" || val === "false") {
        out[key] = val === "true";
      } else if (!isNaN(Number(val))) {
        out[key] = Number(val);
      } else {
        out[key] = val.trim();
      }
    }
    return out;
  }

  private resolveLink(linkOrWikilink: string, sourcePath: string): TFile | null {
    // Accept [[wikilink]] or plain paths
    const wikilink = linkOrWikilink.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const file = this.app.metadataCache.getFirstLinkpathDest(wikilink, sourcePath);
    if (file && file instanceof TFile) return file;

    const direct = this.app.vault.getAbstractFileByPath(wikilink);
    if (direct && direct instanceof TFile) return direct;
    return null;
  }

  /**
   * Very small GPX -> Leaflet polyline parser (trk > trkseg > trkpt lat/lon).
   * Keeps it dependency-free. For advanced features, swap to togeojson.
   */
  private gpxToPolyline(gpxText: string, style: { color?: string } = {}): L.Polyline | null {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(gpxText, "application/xml");
      const trkpts = Array.from(xml.getElementsByTagName("trkpt"));
      if (!trkpts.length) return null;
      const latlngs: L.LatLngExpression[] = trkpts.map((pt) => {
        const lat = parseFloat(pt.getAttribute("lat") || "0");
        const lon = parseFloat(pt.getAttribute("lon") || "0");
        return [lat, lon];
      });
      return L.polyline(latlngs, { weight: 4, opacity: 0.9, ...style });
    } catch (e) {
      console.error("gpxToPolyline parse error", e);
      return null;
    }
  }
}

// Simple resize observer to keep Leaflet happy in Obsidian splits
class ResizeWatcher extends MarkdownRenderChild {
  private ro: ResizeObserver;
  constructor(public el: HTMLElement, private onResize: () => void) {
    super(el);
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.el);
  }
  unload() {
    this.ro.disconnect();
  }
}

// ---------------- Settings Tab ----------------
class OSSettingsTab extends PluginSettingTab {
  plugin: UKOSMapPlugin;

  constructor(app: App, plugin: UKOSMapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "UK OS Map (GPX) — Settings" });

    new Setting(containerEl)
      .setName("OS Data Hub API key")
      .setDesc("Create a key at datahub.os.uk. Used to load OS tiles.")
      .addText((t) =>
        t
          .setPlaceholder("pk.XXXXXXXX")
          .setValue(this.plugin.settings.osApiKey)
          .onChange(async (v) => {
            this.plugin.settings.osApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default OS style")
      .setDesc("Raster ZXY style")
      .addDropdown((d) =>
        d
          .addOptions({
            Outdoor_3857: "Outdoor",
            Leisure_3857: "Leisure",
            Road_3857: "Road",
            Light_3857: "Light",
            Backdrop_3857: "Backdrop"
          })
          .setValue(this.plugin.settings.defaultStyle)
          .onChange(async (v: OSStyleKey) => {
            this.plugin.settings.defaultStyle = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default center (lat, lon)")
      .setDesc("Map center if not specified in a block")
      .addText((t) =>
        t.setPlaceholder("54.5, -3.0")
          .setValue(`${this.plugin.settings.defaultCenter[0]}, ${this.plugin.settings.defaultCenter[1]}`)
          .onChange(async (v) => {
            const m = v.split(",").map((s) => Number(s.trim()));
            if (m.length === 2 && m.every((x) => !isNaN(x))) {
              this.plugin.settings.defaultCenter = [m[0], m[1]];
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default zoom")
      .setDesc("Initial zoom level")
      .addText((t) =>
        t.setPlaceholder("6")
          .setValue(String(this.plugin.settings.defaultZoom))
          .onChange(async (v) => {
            const n = Number(v);
            if (!isNaN(n)) {
              this.plugin.settings.defaultZoom = n;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
