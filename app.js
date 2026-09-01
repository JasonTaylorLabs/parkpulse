/* ParkPulse — live Disneyland Resort map.
   Data: themeparks.wiki open API (CORS-enabled). Imagery: Esri World Imagery.
   Unofficial, non-commercial portfolio demo. Not affiliated with Disney. */
"use strict";

const API = "https://api.themeparks.wiki/v1";

/* Two resorts, one map: the camera stays clamped to whichever resort the
   active park belongs to. */
const RESORTS = {
  anaheim: { bounds: [[-117.9340, 33.7975], [-117.9040, 33.8235]] },
  paris:   { bounds: [[2.7580, 48.8600], [2.7950, 48.8815]] },
};

const PARKS = {
  dl: {
    id: "7340550b-c14d-4def-80bb-acdb51d49a66",
    name: "Disneyland Park",
    resort: "anaheim",
    tz: "America/Los_Angeles",
    tzShort: "PT",
    entrance: [-117.91896, 33.81030], // for GPS demo mode
    center: [-117.91896, 33.81252],
    zoom: 16.05,
    // Approximate land label anchors (hand-placed; labels only, not data)
    lands: [
      { name: "Main Street, U.S.A.", lng: -117.91894, lat: 33.81067 },
      { name: "Adventureland", lng: -117.92030, lat: 33.81147 },
      { name: "New Orleans Square", lng: -117.92148, lat: 33.81180 },
      { name: "Bayou Country", lng: -117.92238, lat: 33.81288 },
      { name: "Frontierland", lng: -117.92062, lat: 33.81269 },
      { name: "Fantasyland", lng: -117.91873, lat: 33.81413 },
      { name: "Mickey's Toontown", lng: -117.91862, lat: 33.81567 },
      { name: "Tomorrowland", lng: -117.91649, lat: 33.81230 },
      { name: "Star Wars: Galaxy's Edge", lng: -117.92273, lat: 33.81450 },
    ],
  },
  dca: {
    id: "832fcd51-ea19-4e77-85c7-75d5843b127c",
    name: "Disney California Adventure",
    resort: "anaheim",
    tz: "America/Los_Angeles",
    tzShort: "PT",
    entrance: [-117.91887, 33.80770],
    center: [-117.91941, 33.80585],
    zoom: 16.05,
    lands: [
      { name: "Buena Vista Street", lng: -117.91870, lat: 33.80803 },
      { name: "Grizzly Peak", lng: -117.92046, lat: 33.80713 },
      { name: "Pixar Pier", lng: -117.92173, lat: 33.80462 },
      { name: "Paradise Gardens Park", lng: -117.92066, lat: 33.80549 },
      { name: "Cars Land", lng: -117.91792, lat: 33.80474 },
      { name: "Hollywood Land", lng: -117.91679, lat: 33.80767 },
      { name: "Avengers Campus", lng: -117.91710, lat: 33.80660 },
      { name: "San Fransokyo Square", lng: -117.91977, lat: 33.80540 },
    ],
  },
  dlp: {
    // Disneyland Park, Paris. The id is verified at runtime against the
    // API's /destinations index (see resolveParkId) so a stale UUID heals
    // itself instead of breaking the park.
    id: "dae968d5-630d-4719-8b06-3d107e944401",
    resolve: { destination: /disneyland paris/i, park: /^disneyland park/i },
    name: "Disneyland Park (Paris)",
    resort: "paris",
    tz: "Europe/Paris",
    tzShort: "Paris",
    entrance: [2.77870, 48.87095],
    center: [2.77610, 48.87270],
    zoom: 16.05,
    lands: [
      { name: "Main Street, U.S.A.", lng: 2.77780, lat: 48.87140 },
      { name: "Frontierland", lng: 2.77100, lat: 48.87350 },
      { name: "Adventureland", lng: 2.77350, lat: 48.87250 },
      { name: "Fantasyland", lng: 2.77610, lat: 48.87440 },
      { name: "Discoveryland", lng: 2.77940, lat: 48.87290 },
    ],
  },
};

const state = {
  park: "dl",
  resort: "anaheim",
  entities: new Map(),   // id -> child entity (name, type, location)
  live: new Map(),       // id -> live data
  markers: new Map(),    // id -> { marker, el }
  landMarkers: [],
  filter: "ATTRACTION",
  query: "",
  selected: null,
  refreshTimer: null,
  lastUpdated: null,
};

const $ = (s) => document.querySelector(s);
// All times render in the active park's own time zone (PT in Anaheim, CET/CEST in Paris)
const fmtPT = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: PARKS[state.park].tz });

/* Attraction photos + blurbs, curated at build time from Wikipedia/Wikimedia
   Commons (freely licensed; hotlinked, credited, never redistributed here). */
let MEDIA = {};
fetch("data/media.json?v=5").then((r) => r.json()).then((m) => { MEDIA = m; }).catch(() => {});
const mediaKey = (s) =>
  s.toLowerCase().replace(/[’‘]/g, "'").replace(/["™]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/* ---------------- map styles ----------------
   Default is an illustrated, in-park-app-style vector look built on
   OpenFreeMap's OpenMapTiles: soft greens, cream walkways, white
   buildings, friendly water. Satellite stays available as a toggle. */
const OMT = { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenStreetMap contributors · OpenFreeMap" } };
// Full-detail resort geometry (attraction footprints, plazas, monorail, rides)
// pulled once from OSM via Overpass and bundled — see data/README note.
const RESORT_SRC = { resort: { type: "geojson", data: "data/resort.geojson?v=5" } };
const ILLUSTRATED_STYLE = {
  version: 8,
  sources: { ...OMT, ...RESORT_SRC },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e7f0d9" } },
    { id: "landuse", type: "fill", source: "openmaptiles", "source-layer": "landuse",
      paint: { "fill-color": "#ece9d8", "fill-opacity": 0.7 } },
    { id: "grass", type: "fill", source: "openmaptiles", "source-layer": "landcover",
      filter: ["in", "class", "grass", "farmland"], paint: { "fill-color": "#c9e2a6" } },
    { id: "wood", type: "fill", source: "openmaptiles", "source-layer": "landcover",
      filter: ["in", "class", "wood", "tree", "forest"], paint: { "fill-color": "#aed593" } },
    { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park",
      paint: { "fill-color": "#c3dfa0", "fill-opacity": 0.85 } },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water",
      paint: { "fill-color": "#8fcff0" } },
    { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway",
      paint: { "line-color": "#8fcff0", "line-width": 2 } },
    { id: "road-casing", type: "line", source: "openmaptiles", "source-layer": "transportation",
      filter: ["!in", "class", "path", "rail", "transit"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#e2d9c4", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 14, 3, 18, 16] } },
    { id: "road", type: "line", source: "openmaptiles", "source-layer": "transportation",
      filter: ["!in", "class", "path", "rail", "transit"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fdfbf4", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 14, 2, 18, 12] } },
    { id: "path", type: "line", source: "openmaptiles", "source-layer": "transportation",
      filter: ["==", "class", "path"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f8f1de", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 14, 1.2, 18, 8] } },
    { id: "rail", type: "line", source: "openmaptiles", "source-layer": "transportation",
      filter: ["==", "class", "rail"],
      paint: { "line-color": "#d9cfba", "line-width": 1.5, "line-dasharray": [3, 2] } },
    { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building",
      paint: { "fill-color": "#fcf9f1", "fill-outline-color": "#ddd2ba", "fill-opacity": 0.96 } },
    /* --- bundled full-detail resort geometry, drawn over the tile base --- */
    { id: "rs-plaza", type: "fill", source: "resort", filter: ["==", ["get", "k"], "plaza"],
      paint: { "fill-color": "#f6efdd" } },
    { id: "rs-zone", type: "fill", source: "resort", filter: ["==", ["get", "k"], "zone"],
      paint: { "fill-color": ["coalesce", ["get", "c"], "#f3ecd9"], "fill-opacity": 0.6 } },
    { id: "rs-water", type: "fill", source: "resort", filter: ["==", ["get", "k"], "water"],
      paint: { "fill-color": "#8fcff0" } },
    { id: "rs-path", type: "line", source: "resort", filter: ["==", ["get", "k"], "path"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f8f1de", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 15, 1.4, 19, 9] } },
    { id: "rs-track", type: "line", source: "resort", filter: ["==", ["get", "k"], "track"],
      paint: { "line-color": "#e3d3b4", "line-width": 1.6 } },
    { id: "rs-rail", type: "line", source: "resort", filter: ["==", ["get", "k"], "rail"],
      paint: { "line-color": "#c2a683", "line-width": 1.6, "line-dasharray": [4, 3] } },
    { id: "rs-monorail-casing", type: "line", source: "resort", filter: ["==", ["get", "k"], "monorail"],
      layout: { "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 4 } },
    { id: "rs-monorail", type: "line", source: "resort", filter: ["==", ["get", "k"], "monorail"],
      layout: { "line-cap": "round" }, paint: { "line-color": "#e0a84f", "line-width": 2.2 } },
    { id: "rs-building-3d", type: "fill-extrusion", source: "resort", filter: ["==", ["get", "k"], "building"],
      paint: { "fill-extrusion-color": ["coalesce", ["get", "c"], "#fcf8ee"], "fill-extrusion-height": ["get", "h"],
               "fill-extrusion-opacity": 0.94 } },
    { id: "rs-attraction-3d", type: "fill-extrusion", source: "resort", filter: ["==", ["get", "k"], "attraction"],
      paint: { "fill-extrusion-color": ["coalesce", ["get", "c"], "#e9eff9"], "fill-extrusion-height": ["get", "h"],
               "fill-extrusion-opacity": 0.97 } },
  ],
  // OpenFreeMap asks for attribution to OpenStreetMap contributors
};
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "sat", type: "raster", source: "esri" }],
};

// The map exists to view the parks — clamp the camera to the active resort.
const map = new maplibregl.Map({
  container: "map",
  center: [-117.91896, 33.80950], // esplanade between the two Anaheim parks
  zoom: 15.5,
  pitch: 0,
  bearing: 0,
  minZoom: 15.05,
  maxZoom: 19.4,
  maxBounds: RESORTS.anaheim.bounds,
  attributionControl: { compact: true },
  style: ILLUSTRATED_STYLE,
});

// Swapping resorts means flying across the world: release the clamp for the
// flight and re-assert it once the camera settles in the new resort.
function applyResort(resortKey) {
  if (state.resort === resortKey) return;
  state.resort = resortKey;
  map.setMaxBounds(null);
  map.once("moveend", () => map.setMaxBounds(RESORTS[resortKey].bounds));
}

// Illustrated <-> satellite toggle (markers are DOM, so they survive setStyle)
let mapMode = "illustrated";
document.getElementById("styleToggle")?.addEventListener("click", () => {
  mapMode = mapMode === "illustrated" ? "satellite" : "illustrated";
  map.setStyle(mapMode === "illustrated" ? ILLUSTRATED_STYLE : SATELLITE_STYLE);
  document.body.classList.toggle("sat-mode", mapMode === "satellite");
  document.getElementById("styleToggle").textContent = mapMode === "illustrated" ? "🛰" : "🗺";
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-left");

map.on("zoom", () => {
  document.body.classList.toggle("zoomed-in", map.getZoom() >= 17.1);
  const showLands = map.getZoom() >= 15.2;
  state.landMarkers.forEach((m) => (m.getElement().style.opacity = showLands ? "" : "0"));
});

/* ---------------- data ---------------- */
async function fetchJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/* A park entry may declare `resolve` matchers: if its hardcoded id ever
   404s, look the real id up in the API's own destinations index and retry. */
async function resolveParkId(park) {
  const dests = await fetchJSON(`${API}/destinations`);
  const dest = dests.destinations.find((d) => park.resolve.destination.test(d.name));
  const p = dest?.parks?.find((x) => park.resolve.park.test(x.name));
  if (!p) throw new Error(`park not found in destinations index`);
  return p.id;
}

async function loadPark(parkKey, { fly } = { fly: true }) {
  const park = PARKS[parkKey];
  state.park = parkKey;
  endDirections();
  clearMarkers();
  banner(null);
  try {
    localStorage.setItem("pp-park", parkKey);
  } catch {}
  try {
    const fetchAll = (id) => Promise.all([
      fetchJSON(`${API}/entity/${id}/children`),
      fetchJSON(`${API}/entity/${id}/live`),
      fetchJSON(`${API}/entity/${id}/schedule`).catch(() => null),
    ]);
    let children, live, schedule;
    try {
      [children, live, schedule] = await fetchAll(park.id);
    } catch (err) {
      if (!park.resolve) throw err;
      park.id = await resolveParkId(park);
      [children, live, schedule] = await fetchAll(park.id);
    }
    state.entities = new Map(
      children.children.filter((c) => c.location).map((c) => [c.id, c])
    );
    ingestLive(live);
    renderHours(schedule);
    buildMarkers(park);
    renderList();
    if (fly) {
      map.resize();
      const crossResort = state.resort !== park.resort;
      applyResort(park.resort);
      const target = { center: park.center, zoom: park.zoom, pitch: 34, bearing: -8 };
      cameraLock = { target, until: Date.now() + 15000 };
      map.flyTo({ ...target, duration: crossResort ? 3800 : 2600, essential: true });
    }
    scheduleRefresh();
  } catch (err) {
    console.error(err);
    banner("Couldn't reach the live data service — retrying shortly.");
    setTimeout(() => loadPark(state.park, { fly: false }), 15000);
  }
}

function ingestLive(liveResp) {
  state.live = new Map(liveResp.liveData.map((l) => [l.id, l]));
  state.lastUpdated = new Date();
  $("#livePill").classList.remove("stale");
  $("#liveLabel").textContent = "LIVE";
}

async function refreshLive() {
  try {
    const live = await fetchJSON(`${API}/entity/${PARKS[state.park].id}/live`);
    ingestLive(live);
    state.markers.forEach((m, id) => updateBadge(id, m.el));
    renderList();
    if (state.selected) renderSheet(state.selected);
  } catch {
    $("#livePill").classList.add("stale");
    $("#liveLabel").textContent = "STALE";
  }
}

function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshLive, 60_000);
}

/* ---------------- wait helpers ---------------- */
function waitInfo(id) {
  const l = state.live.get(id);
  const e = state.entities.get(id);
  const type = e?.entityType;
  if (!l) return { kind: "unknown", label: "—", color: "var(--closed)" };
  const wait = l.queue?.STANDBY?.waitTime;
  switch (l.status) {
    case "OPERATING":
      if (type === "ATTRACTION" && wait != null) {
        const color = wait >= 50 ? "var(--hot)" : wait >= 25 ? "var(--warm)" : "var(--ok)";
        return { kind: "wait", wait, label: String(wait), color };
      }
      return { kind: "open", label: "OPEN", color: type === "RESTAURANT" ? "var(--dine)" : "var(--show)" };
    case "DOWN":
      return { kind: "down", label: "TEMP", color: "var(--warm)" };
    case "REFURBISHMENT":
      return { kind: "refurb", label: "✕", color: "var(--refurb)" };
    default:
      return { kind: "closed", label: "CLOSED", color: "var(--closed)" };
  }
}

function nearestLand(e) {
  const lands = PARKS[state.park].lands;
  let best = null, bd = Infinity;
  for (const l of lands) {
    const d = (l.lng - e.location.longitude) ** 2 + (l.lat - e.location.latitude) ** 2;
    if (d < bd) { bd = d; best = l; }
  }
  return best?.name ?? "";
}

/* ---------------- markers ---------------- */
function clearMarkers() {
  state.markers.forEach((m) => m.marker.remove());
  state.markers.clear();
  state.landMarkers.forEach((m) => m.remove());
  state.landMarkers = [];
  selectEntity(null);
}

function buildMarkers(park) {
  for (const land of park.lands) {
    const el = document.createElement("div");
    el.className = "land-label";
    el.textContent = land.name;
    el.style.transition = "opacity 0.3s";
    const m = new maplibregl.Marker({ element: el }).setLngLat([land.lng, land.lat]).addTo(map);
    state.landMarkers.push(m);
  }
  for (const [id, e] of state.entities) {
    const el = document.createElement("div");
    el.className = "pin";
    el.innerHTML = `<div class="pin-badge"></div><div class="pin-tip"></div><div class="pin-label"></div>`;
    el.querySelector(".pin-label").textContent = e.name;
    el.addEventListener("click", (ev) => { ev.stopPropagation(); selectEntity(id, { fly: true }); });
    updateBadge(id, el);
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([e.location.longitude, e.location.latitude])
      .addTo(map);
    state.markers.set(id, { marker, el });
  }
  applyFilter();
}

function updateBadge(id, el) {
  const e = state.entities.get(id);
  const w = waitInfo(id);
  const badge = el.querySelector(".pin-badge");
  badge.style.setProperty("--wc", w.color);
  badge.className = "pin-badge";
  if (e.entityType === "SHOW") {
    badge.classList.add("show-pin", "icon-only");
    badge.textContent = "★";
  } else if (e.entityType === "RESTAURANT") {
    badge.classList.add("dine-pin", "icon-only");
    badge.textContent = "🍴";
  } else if (w.kind === "wait") {
    badge.innerHTML = `${w.label}<span class="min">MIN</span>`;
  } else if (w.kind === "refurb") {
    badge.classList.add("refurb");
    badge.textContent = "🔧";
  } else if (w.kind === "open") {
    badge.textContent = "•";
  } else {
    badge.classList.add("closed");
    badge.textContent = "–";
  }
}

/* ---------------- filter / search ---------------- */
function applyFilter() {
  const q = state.query.trim().toLowerCase();
  state.markers.forEach((m, id) => {
    const e = state.entities.get(id);
    const typeOK = state.filter === "ALL" || e.entityType === state.filter;
    const qOK = !q || e.name.toLowerCase().includes(q);
    m.el.classList.toggle("dim", !(typeOK && qOK));
  });
  renderList();
}

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.filter = chip.dataset.filter;
    applyFilter();
  })
);
$("#search").addEventListener("input", (e) => { state.query = e.target.value; applyFilter(); });

/* ---------------- selection / sheet ---------------- */
function selectEntity(id, { fly } = {}) {
  if (state.selected) state.markers.get(state.selected)?.el.classList.remove("selected");
  state.selected = id;
  // The sheet and the directions bar share the bottom of the screen:
  // whichever the user summoned last wins, directions resume on close.
  $("#dirbar").hidden = !route.target || !!id;
  if (!id) { $("#sheet").hidden = true; return; }
  const m = state.markers.get(id);
  m?.el.classList.add("selected");
  renderSheet(id);
  $("#sheet").hidden = false;
  if (fly) {
    const e = state.entities.get(id);
    map.easeTo({ center: [e.location.longitude, e.location.latitude], zoom: Math.max(map.getZoom(), 17.4), duration: 700 });
  }
}
map.on("click", () => selectEntity(null));

function renderSheet(id) {
  const e = state.entities.get(id);
  const l = state.live.get(id);
  const w = waitInfo(id);
  const land = nearestLand(e);
  const typeLabel = { ATTRACTION: "Attraction", SHOW: "Entertainment", RESTAURANT: "Dining" }[e.entityType];
  const statusText = { OPERATING: "Open", DOWN: "Temporarily down", REFURBISHMENT: "Refurbishment", CLOSED: "Closed" }[l?.status] ?? "Unknown";
  const statusColor = { OPERATING: "var(--ok)", DOWN: "var(--warm)", REFURBISHMENT: "var(--refurb)", CLOSED: "var(--closed)" }[l?.status] ?? "var(--closed)";
  const showtimes = (l?.showtimes ?? [])
    .slice(0, 4)
    .map((s) => fmtPT(s.startTime))
    .join(" · ");
  const ll = l?.queue?.PAID_RETURN_TIME;
  const stats = [];
  if (w.kind === "wait") stats.push(stat("Standby wait", `${w.wait}<small> min</small>`));
  stats.push(stat("Status", `<span class="status-chip" style="background:${statusColor}">${statusText.toUpperCase()}</span>`));
  if (ll?.price) stats.push(stat("Lightning Lane", `${ll.price.formatted}<small> · ${ll.returnStart ? fmtPT(ll.returnStart) : "—"}</small>`));
  if (showtimes) stats.push(stat("Next showtimes", `<small style="font-size:13px;font-weight:700">${showtimes}</small>`));
  stats.push(stat("Updated", `<small style="font-size:13px;font-weight:700">${state.lastUpdated ? fmtPT(state.lastUpdated) : "—"}</small>`));

  const m = MEDIA[mediaKey(e.name)];
  const hero = m ? `<img class="sheet-img" src="${m.img}" alt="${esc(e.name)}" decoding="async" onerror="this.remove()">` : "";
  const about = m && m.ext ? `
    <p class="sheet-about">${esc(m.ext)}</p>
    <a class="sheet-credit" href="${m.url}" target="_blank" rel="noopener">Photo &amp; summary via Wikipedia · CC-licensed</a>` : "";
  $("#sheetBody").innerHTML = `
    ${hero}
    <div class="sheet-top">
      <div>
        <div class="sheet-title">${esc(e.name)}</div>
        <div class="sheet-sub">${typeLabel} · ${esc(land)} · ${PARKS[state.park].name}</div>
      </div>
      <button class="sheet-close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-stats">${stats.join("")}</div>
    <div class="sheet-actions">
      <button class="act-btn primary" id="sheetDirBtn">🧭 Directions</button>
      <a class="act-btn" href="${appleMapsURL(e)}" target="_blank" rel="noopener"> Apple Maps</a>
    </div>
    ${about}`;
  $("#sheetBody .sheet-close").addEventListener("click", () => selectEntity(null));
  $("#sheetDirBtn").addEventListener("click", () => startDirections(id));
}
const stat = (label, value) => `<div class="stat"><div class="s-label">${label}</div><div class="s-value">${value}</div></div>`;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- list drawer ---------------- */
$("#listToggle").addEventListener("click", () => { $("#drawer").hidden = false; renderList(); });
$("#drawerClose").addEventListener("click", () => { $("#drawer").hidden = true; });

function renderList() {
  if ($("#drawer").hidden) return;
  const q = state.query.trim().toLowerCase();
  const rows = [...state.entities.values()]
    .filter((e) => (state.filter === "ALL" || e.entityType === state.filter) && (!q || e.name.toLowerCase().includes(q)))
    .map((e) => ({ e, w: waitInfo(e.id) }))
    .sort((a, b) => {
      const wa = a.w.kind === "wait" ? a.w.wait : -1;
      const wb = b.w.kind === "wait" ? b.w.wait : -1;
      return wb - wa || a.e.name.localeCompare(b.e.name);
    });
  $("#drawerTitle").textContent =
    state.filter === "ATTRACTION" ? "Wait times" :
    state.filter === "SHOW" ? "Entertainment" :
    state.filter === "RESTAURANT" ? "Dining" : "Everything";
  $("#waitList").innerHTML = rows.map(({ e, w }) => `
    <li><button class="wait-row" data-id="${e.id}">
      <span class="w-badge ${w.kind === "wait" ? "" : "txt"}" style="--pc:${w.color};${w.kind !== "wait" ? `background:${w.color}` : ""}">${w.kind === "wait" ? w.label : w.label}</span>
      <span><span class="w-name">${esc(e.name)}</span><div class="w-sub">${esc(nearestLand(e))}</div></span>
    </button></li>`).join("");
  $("#waitList").querySelectorAll(".wait-row").forEach((btn) =>
    btn.addEventListener("click", () => { $("#drawer").hidden = true; selectEntity(btn.dataset.id, { fly: true }); })
  );
}

/* ---------------- park switch + hours ---------------- */
document.querySelectorAll(".park-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (btn.dataset.park === state.park) return;
    document.querySelectorAll(".park-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    loadPark(btn.dataset.park);
  })
);

function renderHours(scheduleResp) {
  const pill = $("#hoursPill");
  if (!scheduleResp) { pill.hidden = true; return; }
  const park = PARKS[state.park];
  // "today" in the park's own time zone (en-CA formats as YYYY-MM-DD)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: park.tz }).format(new Date());
  const s = scheduleResp.schedule.find((x) => x.date === today && x.type === "OPERATING");
  if (!s) { pill.hidden = true; return; }
  pill.innerHTML = `Today <b>${fmtPT(s.openingTime)} – ${fmtPT(s.closingTime)} ${park.tzShort}</b>`;
  pill.hidden = false;
}

function banner(msg) {
  const b = $("#banner");
  if (!msg) { b.hidden = true; return; }
  b.textContent = msg;
  b.hidden = false;
}

/* ---------------- GPS + walking directions ----------------
   Type an attraction name, tap it, hit Directions: a live blue dot for you,
   a dashed line to the ride, distance / walk time / compass heading updating
   as you move (watchPosition), and an Apple Maps handoff for real
   turn-by-turn. Far from the park? Demo mode pins "you" at the park gate so
   the whole flow can be exercised from the couch. */
const geo = { watchId: null, pos: null, accuracy: null, marker: null, demo: false };
const route = { target: null, fitted: false };

const appleMapsURL = (e) =>
  `https://maps.apple.com/?daddr=${e.location.latitude},${e.location.longitude}&dirflg=w&q=${encodeURIComponent(e.name)}`;

const toRad = (d) => (d * Math.PI) / 180;
function haversineM(a, b) { // [lng,lat] pairs -> meters
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearingDeg(a, b) {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const compass8 = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : m < 100000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`);
const fmtWalk = (m) => { // ~4.8 km/h
  const min = m / 80;
  if (min < 1) return "<1 min";
  if (min < 90) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ${Math.round(min % 60)} min` : "—";
};

function geoAvailable() {
  if (!("geolocation" in navigator)) { banner("This device doesn't support geolocation."); return false; }
  if (!window.isSecureContext) { banner("Location needs HTTPS — open the site via its https:// address."); return false; }
  return true;
}

function startWatch() {
  if (geo.watchId != null || !geoAvailable()) return;
  $("#locateBtn").classList.add("watching");
  geo.watchId = navigator.geolocation.watchPosition(
    (p) => { if (!geo.demo) setUserPos([p.coords.longitude, p.coords.latitude], p.coords.accuracy); },
    (err) => {
      $("#locateBtn").classList.remove("watching");
      geo.watchId = null;
      banner(err.code === 1
        ? "Location permission denied — allow it in Settings → Privacy → Location Services → Safari Websites."
        : "Couldn't get a GPS fix — try again with a clear view of the sky.");
      setTimeout(() => banner(null), 6000);
      updateDirections();
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
  );
}

function setUserPos(lngLat, accuracy) {
  geo.pos = lngLat;
  geo.accuracy = accuracy;
  if (!geo.marker) {
    const el = document.createElement("div");
    el.className = "user-dot" + (geo.demo ? " demo" : "");
    el.innerHTML = `<div class="user-halo"></div><div class="user-core"></div>`;
    geo.marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  } else {
    geo.marker.setLngLat(lngLat);
    geo.marker.getElement().classList.toggle("demo", geo.demo);
  }
  updateDirections();
}

function insideResort(lngLat) {
  const [[w, s], [e, n]] = RESORTS[state.resort].bounds;
  return lngLat[0] >= w && lngLat[0] <= e && lngLat[1] >= s && lngLat[1] <= n;
}

$("#locateBtn").addEventListener("click", () => {
  if (geo.demo) setDemo(false);
  startWatch();
  if (geo.pos && insideResort(geo.pos)) {
    map.easeTo({ center: geo.pos, zoom: Math.max(map.getZoom(), 17), duration: 600 });
  } else if (geo.pos) {
    const d = haversineM(geo.pos, PARKS[state.park].center);
    banner(`You're ${fmtDist(d)} from ${PARKS[state.park].name} — the map stays on the resort. Use demo mode in Directions to simulate being there.`);
    setTimeout(() => banner(null), 6000);
  }
});

function setDemo(on) {
  geo.demo = on;
  $("#demoBtn")?.classList.toggle("on", on);
  if (on) {
    setUserPos(PARKS[state.park].entrance, 8);
    route.fitted = false; // re-frame now that "you" are at the gate
    updateDirections();
  } else {
    geo.pos = null;
    if (geo.marker) { geo.marker.remove(); geo.marker = null; }
    startWatch();
    updateDirections();
  }
}

/* Route line lives in the map style, which setStyle() (satellite toggle)
   wipes — so re-add it whenever a style finishes loading. */
const routeFeature = (from, to) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [from, to] } });
function drawRoute(from, to) {
  const data = routeFeature(from, to);
  const src = map.getSource("pp-route");
  if (src) { src.setData(data); return; }
  map.addSource("pp-route", { type: "geojson", data });
  map.addLayer({
    id: "pp-route-line", type: "line", source: "pp-route",
    layout: { "line-cap": "round" },
    paint: { "line-color": "#1d7fd6", "line-width": 4.5, "line-dasharray": [0.1, 1.8], "line-opacity": 0.9 },
  });
}
function removeRoute() {
  if (map.getLayer("pp-route-line")) map.removeLayer("pp-route-line");
  if (map.getSource("pp-route")) map.removeSource("pp-route");
}
map.on("style.load", () => {
  const e = route.target && state.entities.get(route.target);
  if (e && geo.pos) drawRoute(geo.pos, [e.location.longitude, e.location.latitude]);
});

function startDirections(id) {
  route.target = id;
  route.fitted = false;
  selectEntity(null); // close the sheet; dirbar takes the bottom slot
  $("#dirbar").hidden = false;
  startWatch();
  updateDirections();
  const e = state.entities.get(id);
  if (!geo.pos) map.easeTo({ center: [e.location.longitude, e.location.latitude], zoom: Math.max(map.getZoom(), 16.6), duration: 600 });
}

function endDirections() {
  route.target = null;
  $("#dirbar").hidden = true;
  removeRoute();
}

function updateDirections() {
  if (!route.target) return;
  const e = state.entities.get(route.target);
  if (!e) { endDirections(); return; }
  $("#dirName").textContent = e.name;
  $("#appleLink").href = appleMapsURL(e);
  const waiting = $("#dirWaiting"), stats = $("#dirStats"), hint = $("#dirHint");
  if (!geo.pos) {
    waiting.hidden = false;
    stats.hidden = true;
    hint.hidden = false;
    hint.textContent = "Not at the park? Try demo mode:";
    removeRoute();
    return;
  }
  waiting.hidden = true;
  stats.hidden = false;
  const to = [e.location.longitude, e.location.latitude];
  const d = haversineM(geo.pos, to);
  const brg = bearingDeg(geo.pos, to);
  $("#dirDist").textContent = fmtDist(d);
  $("#dirWalk").textContent = fmtWalk(d);
  $("#dirHead").textContent = `${compass8(brg)} ${Math.round(brg)}°`;
  $("#dirAcc").textContent = geo.demo ? "demo GPS" : geo.accuracy ? `±${Math.round(geo.accuracy)} m GPS` : "";
  drawRoute(geo.pos, to);
  const far = d > 3000 && !geo.demo;
  hint.hidden = !far;
  if (far) hint.textContent = `You're ${fmtDist(d)} away — walk time is theoretical. Simulate being at the gate:`;
  if (!route.fitted && insideResort(geo.pos)) {
    route.fitted = true;
    map.fitBounds([geo.pos, to], { padding: { top: 140, bottom: 220, left: 60, right: 60 }, maxZoom: 17.6, duration: 900 });
  }
}

$("#dirClose").addEventListener("click", endDirections);
$("#demoBtn").addEventListener("click", () => setDemo(!geo.demo));

/* ---------------- go ---------------- */
// Don't gate on the map "load" event: with a raster basemap it can stay
// pending while distant tiles stream. Data + DOM markers don't need it.
// Embedded/webview browsers can settle the viewport late (and throttle
// timers), so instead of waiting we fly immediately and hold a short
// "camera lock": any late resize re-asserts the intended view until the
// user takes over or the lock expires.
let cameraLock = null;
new ResizeObserver(() => {
  map.resize();
  if (cameraLock && Date.now() < cameraLock.until) map.jumpTo(cameraLock.target);
}).observe(document.getElementById("map"));
["mousedown", "touchstart", "wheel"].forEach((ev) =>
  map.getCanvas().addEventListener(ev, () => { cameraLock = null; }, { passive: true })
);

// Come back to the park you were last looking at (nice on a phone).
let bootPark = "dl";
try { bootPark = localStorage.getItem("pp-park") in PARKS ? localStorage.getItem("pp-park") : "dl"; } catch {}
document.querySelectorAll(".park-btn").forEach((b) => {
  const on = b.dataset.park === bootPark;
  b.classList.toggle("active", on);
  b.setAttribute("aria-selected", String(on));
});
loadPark(bootPark);
