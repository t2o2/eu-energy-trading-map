# European Power Trading Map

Live cross-border electricity flows across Europe on a real map: each country is
shaded by the carbon intensity of what it is generating right now, and every
interconnector carries an animated arrow whose direction, length and thickness
show where power is actually moving and how much.

![map](docs/screenshot.png)

## Running

```bash
npm install
npm run geo     # precompute country polygons + border anchors (~90s, already committed)
npm run dev
```

Open http://localhost:3000. With no API token the app serves realistic simulated
data, so it works immediately.

### Live data

ENTSO-E's Transparency Platform is the source for real figures. Register at
<https://transparency.entsoe.eu>, then email `transparency@entsoe.eu` from the
registered address with subject "Restful API access". Approval is manual.

```bash
cp .env.example .env.local   # then paste your token into ENTSOE_TOKEN
```

The app switches to live data automatically when `ENTSOE_TOKEN` is set.

## How it works

**Data.** `GridSource` (`src/lib/sources/source.ts`) has two implementations:
`MockSource` and `EntsoeSource`. Everything downstream is keyed on ENTSO-E EIC
area codes rather than ISO country codes, so moving from country-level to
bidding-zone level later is a data change rather than a rewrite.

`EntsoeSource` issues three queries per country (`A75` generation per production
type, `A65` actual load, `A44` day-ahead price) and two per border (`A11`
cross-border physical flow, once in each direction, netted into a signed value).
That is roughly 260 requests per refresh against a documented limit of 400 per
minute, so they run through a concurrency limit of 10. Partial failures are
reported in `GridSnapshot.degraded` rather than failing the whole snapshot.

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

**Rendering.** MapLibre GL with a CARTO raster basemap (no API key). Countries
are a fill layer coloured through `feature-state`; flows are a line layer plus an
arrowhead symbol layer, with travelling pulses on a separate source updated each
animation frame.

## Notes

- Arrows show **physical** flows, i.e. what moves through the wires. Scheduled
  commercial exchanges (`A09`) differ because of loop flows.
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
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
