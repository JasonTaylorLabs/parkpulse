# ParkPulse

**A live, interactive map of the Disneyland Resort — real attractions, real-time wait times, real satellite imagery.**

What this proves: I can ship a polished, data-dense live product experience — the Disney Experiences app's map, rebuilt as a fast, dependency-light web app against open live data.

![ParkPulse](docs/screenshot.png)

## Features

- **Live wait times** for every attraction in Disneyland Park and Disney California Adventure, refreshed every 60 seconds, color-coded (green ≤ 20 min, amber 25–45, red 50+), with temporary-closure and refurbishment states
- **Illustrated park-app cartography**: a custom-styled vector basemap (OpenFreeMap/OpenMapTiles over MapLibre GL) — soft greens, cream walkways, white buildings, friendly water — in the visual language of in-park map apps, with hand-placed land labels (Fantasyland, Galaxy's Edge, Cars Land…), zoom-aware attraction labels, and a one-tap **satellite mode** (Esri World Imagery)
- **Resort-locked camera**: map bounds and zoom are clamped to the two parks — the map is the resort, not greater Anaheim
- **120 real places** per park — attractions, entertainment, and dining — from the open themeparks.wiki API, each with exact coordinates
- **Detail cards**: standby wait, operating status, Lightning Lane price & return window when offered, next showtimes, last-updated stamp — all in park time (PT)
- **Wait-time list** sorted longest-first, search, and category filters, mirroring the in-park app's mental model
- **Park switcher**: Disneyland ↔ California Adventure with a full data reload and fly-over
- Today's real **park hours** in the header
- Zero build step, zero framework: three files of vanilla HTML/CSS/JS + MapLibre GL from a CDN

## Run it

Any static server works:

```bash
python3 -m http.server 4173
```

Then open http://localhost:4173. (Live data requires network; the API is CORS-open.)

## Architecture notes

- `themeparks.wiki` provides `children` (entity catalog + coordinates), `live` (status/queues/showtimes), and `schedule` (hours) per park — joined client-side by entity id; DOM markers update in place on each refresh, so pins never flicker
- The illustrated style is ~12 hand-authored MapLibre layers against OpenMapTiles vector tiles — no style server, no API key; satellite mode swaps the full style object while DOM markers persist
- The map deliberately avoids the `load` event as a readiness gate (raster tile streams can defer it indefinitely) and instead treats data, markers, and camera as independent of style readiness; a viewport-stability check makes the intro fly-in robust inside embedded webviews
- Land labels and the "nearest land" attribution on detail cards are hand-placed anchors — the public API doesn't expose land grouping

## Data & IP

> Unofficial, non-commercial portfolio project. Not affiliated with, endorsed by, or sponsored by The Walt Disney Company. Attraction, land, and park names appear as factual data. Live data courtesy of the open [themeparks.wiki](https://themeparks.wiki) API. Imagery © Esri, Maxar, Earthstar Geographics. No Disney-owned assets are included in this repository.

## License

MIT — see [LICENSE](LICENSE).
