# European Power Trading Map

Live cross-border electricity flows across Europe on a real map: each country is
shaded by the carbon intensity of what it is generating right now, and every
interconnector carries an animated arrow whose direction, length and thickness
show where power is actually moving and how much. A toggleable layer plots every
power station of 100 MW and above, with live output where its TSO publishes it.

![map](docs/screenshot.png)

The power station layer, on live ENTSO-E data. Pies show output against nameplate
capacity; flat dots are stations whose TSO publishes no per-unit figures.

![power stations](docs/screenshot-plants.png)

## Running

```bash
npm install
npm run geo       # precompute country polygons + border anchors (~90s, already committed)
npm run plants    # precompute power station locations (already committed)
npm run snapshot  # fetch grid data into public/data/snapshot.json
npm run dev
```

Open <http://localhost:3000>. With no API token the app serves realistic simulated
data, so it works immediately.

### Live data

ENTSO-E's Transparency Platform is the source for real figures. Register at
<https://transparency.entsoe.eu>, then email `transparency@entsoe.eu` from the
registered address with subject "Restful API access". Approval is manual.

```bash
cp .env.example .env.local   # then paste your token into ENTSOE_TOKEN
```

The app switches to live data automatically when `ENTSOE_TOKEN` is set. Rerun
`npm run snapshot` to pull fresh figures.

## Deployment

The site is a static export hosted on GitHub Pages. There is no server: the grid
data is fetched at build time into `public/data/snapshot.json` and shipped as a
plain file, so `.github/workflows/deploy.yml` rebuilds and redeploys hourly on a
cron to keep it current.

To host your own copy:

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions: add `ENTSOE_TOKEN`. Without it the
   deployed site serves simulated data.
3. Push to `main`, or run the workflow manually from the Actions tab.

GitHub's cron is best-effort and often runs late, so the data can be an hour or
so stale; the UI always shows the snapshot's own timestamp. Scheduled workflows
are also disabled automatically after 60 days without repository activity.

## How it works

**Data.** `GridSource` (`src/lib/sources/source.ts`) has two implementations:
`MockSource` and `EntsoeSource`. Everything downstream is keyed on ENTSO-E EIC
area codes rather than ISO country codes, so moving from country-level to
bidding-zone level later is a data change rather than a rewrite.

`EntsoeSource` issues four queries per country (`A75` generation per production
type, `A65` actual load, `A44` day-ahead price, `A73` actual generation per
unit) and two per border (`A11` cross-border physical flow, once in each
direction, netted into a signed value). That is roughly 300 requests per refresh
against a documented limit of 400 per minute, so they run through a concurrency
limit of 10. Partial failures are reported in `GridSnapshot.degraded` rather
than failing the whole snapshot.

Results are cached in-process for 15 minutes to match ENTSO-E's publication
cadence, concurrent misses are collapsed into a single upstream fetch, and stale
data is served for up to two hours if the upstream goes down.

**Geometry.** `npm run geo` precomputes `public/geo/`:

- `countries.json` — Natural Earth 1:50m polygons, clipped to the European view.
- `borders.json` — one anchor point and bearing per border.

Border anchors are the centroid of the *shared boundary segment* between two
countries, found by densifying one outline and keeping the vertices that lie
within tolerance of the other. Where two countries meet along several stretches,
the longest run wins, so the arrow lands on the main border rather than an
average that could fall outside both countries. Borders with no shared land
boundary — NorNed, Viking Link, NordBalt and the other subsea cables — fall back
to the midpoint of the shortest line between the two coastlines, and a
separation pass pushes apart anchors that would otherwise stack up in the Dover
Strait. 65 land borders, 15 subsea cables, no hand-curated coordinates.

**Power stations.** `npm run plants` precomputes `public/geo/plants.json`: the
1,314 stations of 100 MW and above inside the ENTSO-E areas, from the WRI Global
Power Plant Database (CC-BY 4.0). Marker area scales with nameplate capacity and
colour follows the same fuel palette as the country panel.

The two data states are drawn differently, because they carry different
information. A station with matched live output is a **pie**: the filled wedge
is current output as a share of nameplate capacity, so a glance across France
shows which reactors are at full power and which are down. A station without
live output is a **flat, dimmed dot** in the same fuel colour — drawing it as a
pie at 0% would assert it is idle, which we do not know. Pie images are cached
per (fuel, 5% bucket), so ~1,300 markers cost a few hundred small icons.

Live output is a separate problem. ENTSO-E publishes per-unit generation (`A73`)
keyed on unit EIC codes with **no coordinates**; WRI publishes coordinates with
**no EIC codes**. There is no shared key, so `joinLiveOutput` matches on
normalised station names within an area — stripping diacritics, corporate
suffixes and trailing unit designators, so ENTSO-E's `CATTENOM 3` aggregates
onto WRI's `Cattenom`. The match is deliberately strict: a loose match would
attach one station's output to another's location, which is worse than showing
nothing. Plants with matched live data get a white ring; the popup distinguishes
"no live output matched" from "this country publishes none at all".

Against live French data this matches 21 of the 23 stations above 1000 MW and
84% of the country's mapped capacity. The two misses, Fessenheim and
Porcheville, both closed after WRI's 2021 snapshot, so they correctly show no
live output.

**Rendering.** MapLibre GL with a CARTO raster basemap (no API key). Countries
are a fill layer coloured through `feature-state`; flows are a line layer plus an
arrowhead symbol layer, with travelling pulses on a separate source updated each
animation frame.

## Notes

- Arrows show **physical** flows, i.e. what moves through the wires. Scheduled
  commercial exchanges (`A09`) differ because of loop flows.
- Per-unit output is published by only a minority of TSOs — France reports ~150
  units, Germany none — so the ring markers cluster in a few countries. That is
  upstream coverage, not a bug.
- The plant list is a 2021 snapshot, so stations commissioned or retired since
  are missing. Where a plant now generates above its recorded nameplate
  (Flamanville, after EPR unit 3), the popup says so rather than printing a
  percentage over 100.
- WRI does not distinguish lignite from hard coal, so both render as `coal`;
  pumped storage is only separated from hydro when the station name says so.
- Countries with several bidding zones (Norway, Sweden, Denmark, Italy) are shown
  aggregated, so intra-country congestion is not visible.
- Carbon intensities are IPCC AR5 lifecycle medians applied to the live mix.
- Pinned to `maplibre-gl` 5.24.0: in 6.0.0 `GeoJSONSource.setData` silently fails
  to populate the source and nothing renders.

## Scripts

| command | purpose |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm run geo` | rebuild map geometry from Natural Earth |
| `npm run plants` | rebuild power station locations from WRI GPPD |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
