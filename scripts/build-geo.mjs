/**
 * Precomputes the map geometry so the browser never does topology work:
 *
 *   public/geo/countries.json  - GeoJSON polygons for every ENTSO-E area
 *   public/geo/borders.json    - one anchor point + bearing per border
 *
 * Border anchors are the centroid of the *shared boundary segment* between two
 * countries, found by keeping the vertices of A's outline that lie within a
 * tolerance of B's outline. Borders with no shared land boundary (subsea
 * cables such as NorNed or Viking Link) fall back to the midpoint of the
 * shortest line between the two coastlines, which puts the arrow at sea
 * roughly where the cable runs.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as turf from '@turf/turf';

// Node >= 22.6 strips TypeScript types on import, so the geometry build reads
// the same area/border definitions the app uses rather than a copy.
import { AREAS, BORDERS } from '../src/lib/domain/areas.ts';

const require = createRequire(import.meta.url);
const topojson = require('topojson-client');
const world = require('world-atlas/countries-50m.json');

/** ISO 3166-1 alpha-2 -> numeric id used by Natural Earth / world-atlas. */
const ISO2_TO_NUMERIC = {
  AL: '008', AT: '040', BA: '070', BE: '056', BG: '100', CH: '756', CZ: '203',
  DE: '276', DK: '208', EE: '233', ES: '724', FI: '246', FR: '250', GB: '826',
  GR: '300', HR: '191', HU: '348', IE: '372', IT: '380', LT: '440', LU: '442',
  LV: '428', MD: '498', ME: '499', MK: '807', NL: '528', NO: '578', PL: '616',
  PT: '620', RO: '642', RS: '688', SE: '752', SI: '705', SK: '703', UA: '804',
  TR: '792',
};

/** Kosovo has no numeric id in world-atlas; it is matched by name instead. */
const ISO2_BY_NAME = { Kosovo: 'XK' };

/** Degrees of tolerance when deciding two outlines describe the same border. */
const SHARED_BORDER_TOLERANCE_DEG = 0.06;

/** Minimum vertices before we trust a match as a real land border. */
const MIN_SHARED_VERTICES = 2;

const fc = topojson.feature(world, world.objects.countries);

const byIso2 = new Map();
const numericToIso2 = new Map(Object.entries(ISO2_TO_NUMERIC).map(([k, v]) => [v, k]));

for (const feature of fc.features) {
  const iso2 =
    numericToIso2.get(String(feature.id)) ?? ISO2_BY_NAME[feature.properties?.name];
  if (!iso2) continue;
  byIso2.set(iso2, feature);
}

/**
 * Trim mainland-only view: drop far-flung overseas territories that would
 * otherwise stretch the map to French Guiana and the Canaries.
 */
const VIEWPORT = turf.bboxPolygon([-26, 33, 46, 72]);

function clipToViewport(feature) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  const kept = polygons.filter((coords) => {
    const poly = turf.polygon(coords);
    return turf.booleanIntersects(poly, VIEWPORT);
  });
  if (kept.length === 0) return null;
  return turf.multiPolygon(kept, feature.properties);
}

/** Every outline (exterior ring) of a feature, as LineStrings. */
function outlines(feature) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polygons.map((coords) => turf.lineString(coords[0]));
}

/** Densify a ring so short borders still contribute enough vertices. */
function densify(line, stepKm = 12) {
  const length = turf.length(line, { units: 'kilometers' });
  if (length === 0) return [];
  const n = Math.min(2000, Math.max(2, Math.ceil(length / stepKm)));
  const points = [];
  for (let i = 0; i <= n; i++) {
    points.push(turf.along(line, (length * i) / n, { units: 'kilometers' }).geometry.coordinates);
  }
  return points;
}

function bboxOverlaps(a, b, pad) {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}

/**
 * Vertices of A that sit on B's outline, i.e. the shared border.
 * Returns [] when the two countries do not touch.
 */
function sharedBorderPoints(featA, featB) {
  const linesB = outlines(featB);
  const bboxB = linesB.map((l) => turf.bbox(l));
  const hits = [];

  for (const lineA of outlines(featA)) {
    const bboxA = turf.bbox(lineA);
    const candidates = linesB.filter((_, i) =>
      bboxOverlaps(bboxA, bboxB[i], SHARED_BORDER_TOLERANCE_DEG),
    );
    if (candidates.length === 0) continue;

    for (const coord of densify(lineA)) {
      const pt = turf.point(coord);
      for (const lineB of candidates) {
        const d = turf.pointToLineDistance(pt, lineB, { units: 'degrees' });
        if (d <= SHARED_BORDER_TOLERANCE_DEG) {
          hits.push(coord);
          break;
        }
      }
    }
  }
  return hits;
}

/**
 * Largest contiguous run of shared points. Two countries can meet along more
 * than one stretch (Italy and Switzerland, Croatia and Bosnia); we anchor the
 * arrow on the longest one rather than the average, which could fall outside
 * both countries.
 */
function longestRun(points, gapKm = 90) {
  if (points.length === 0) return [];
  let best = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const gap = turf.distance(turf.point(points[i - 1]), turf.point(points[i]), {
      units: 'kilometers',
    });
    if (gap > gapKm) {
      if (current.length > best.length) best = current;
      current = [];
    }
    current.push(points[i]);
  }
  return current.length > best.length ? current : best;
}

/** Shortest line between two coastlines: where a subsea cable would run. */
function seaCableAnchor(featA, featB) {
  let best = null;
  for (const lineA of outlines(featA)) {
    for (const coord of densify(lineA, 40)) {
      const pt = turf.point(coord);
      for (const lineB of outlines(featB)) {
        const snapped = turf.nearestPointOnLine(lineB, pt, { units: 'kilometers' });
        const d = snapped.properties.dist;
        if (best === null || d < best.dist) {
          best = { dist: d, a: coord, b: snapped.geometry.coordinates };
        }
      }
    }
  }
  if (!best) return null;
  return {
    anchor: turf.midpoint(turf.point(best.a), turf.point(best.b)).geometry.coordinates,
    bearing: turf.bearing(turf.point(best.a), turf.point(best.b)),
  };
}

const countries = { type: 'FeatureCollection', features: [] };
const clipped = new Map();

for (const area of AREAS) {
  const feature = byIso2.get(area.iso2);
  if (!feature) {
    console.warn(`no polygon for ${area.iso2} (${area.name})`);
    continue;
  }
  const trimmed = clipToViewport(feature);
  if (!trimmed) continue;
  trimmed.properties = { code: area.code, iso2: area.iso2, name: area.name };
  trimmed.id = area.iso2;
  clipped.set(area.iso2, trimmed);
  countries.features.push(trimmed);
}

const borders = { type: 'FeatureCollection', features: [] };
let land = 0;
let sea = 0;

for (const border of BORDERS) {
  const featA = clipped.get(border.isoA);
  const featB = clipped.get(border.isoB);
  if (!featA || !featB) {
    console.warn(`skipping border ${border.isoA}-${border.isoB}: missing polygon`);
    continue;
  }

  const run = longestRun(sharedBorderPoints(featA, featB));
  let anchor;
  let bearing;
  let kind;

  if (run.length >= MIN_SHARED_VERTICES) {
    anchor = turf.center(turf.featureCollection(run.map((c) => turf.point(c)))).geometry.coordinates;
    // Point the arrow across the border, from A's side toward B's side.
    bearing = turf.bearing(
      turf.centerOfMass(featA),
      turf.centerOfMass(featB),
    );
    kind = 'land';
    land++;
  } else {
    const cable = seaCableAnchor(featA, featB);
    if (!cable) {
      console.warn(`no anchor for ${border.isoA}-${border.isoB}`);
      continue;
    }
    anchor = cable.anchor;
    bearing = cable.bearing;
    kind = 'sea';
    sea++;
  }

  borders.features.push({
    type: 'Feature',
    id: `${border.a}|${border.b}`,
    geometry: { type: 'Point', coordinates: [anchor[0], anchor[1]] },
    properties: {
      a: border.a,
      b: border.b,
      isoA: border.isoA,
      isoB: border.isoB,
      // Bearing in degrees from A to B; the renderer flips it when flow reverses.
      bearing: round(bearing),
      kind,
    },
  });
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Several cables genuinely cross the same strait: IFA, Nemo Link and BritNed
 * all land within ~80 km of Dover, so the raw shortest-line anchors stack on
 * top of each other. Push overlapping anchors apart along the line joining the
 * two country centroids until they are visually distinguishable.
 */
function decollide(features, minSeparationKm = 85, passes = 40) {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const p = turf.point(features[i].geometry.coordinates);
        const q = turf.point(features[j].geometry.coordinates);
        const d = turf.distance(p, q, { units: 'kilometers' });
        if (d >= minSeparationKm) continue;

        // Separate along the axis between them, or along each pair's own
        // centroid axis when they are exactly coincident.
        const away = d > 0.001 ? turf.bearing(p, q) : features[i].properties.bearing + 90;
        const shift = (minSeparationKm - d) / 2 + 1;
        features[i].geometry.coordinates = turf.destination(p, shift, away + 180, {
          units: 'kilometers',
        }).geometry.coordinates;
        features[j].geometry.coordinates = turf.destination(q, shift, away, {
          units: 'kilometers',
        }).geometry.coordinates;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const f of features) {
    f.geometry.coordinates = f.geometry.coordinates.map(round);
  }
}

decollide(borders.features);

mkdirSync('public/geo', { recursive: true });
writeFileSync('public/geo/countries.json', JSON.stringify(countries));
writeFileSync('public/geo/borders.json', JSON.stringify(borders, null, 2));

console.log(
  `wrote ${countries.features.length} countries, ${borders.features.length} borders (${land} land, ${sea} sea)`,
);
