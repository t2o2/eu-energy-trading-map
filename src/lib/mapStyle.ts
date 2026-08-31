import type { RequestParameters } from 'maplibre-gl';

/**
 * CARTO's hosted Dark Matter vector basemap. Vector stays sharp at any zoom and
 * carries fresher data than the raster tiles we used before, which CARTO is
 * retiring. Our own data layers are added on top in FlowMap.
 *
 * CARTO and OpenStreetMap attribution arrives with the style's TileJSON and is
 * rendered by MapLibre's attribution control — the free tier requires it to stay
 * visible.
 */
export const BASE_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * CARTO basemap key. Vector tiles do not require one yet, but CARTO has said the
 * requirement is coming, so basemap requests carry it already and the switch-on
 * will be a non-event.
 *
 * NEXT_PUBLIC_ is inlined into the client bundle at build time. That is inherent
 * to a browser map — the key travels in every tile request and is visible in
 * devtools. Keeping it in the environment only keeps it out of the repository.
 */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY ?? '';

/** basemaps.cartocdn.com plus its tiles-a…d shards. */
const CARTO_HOST = /(^|\.)basemaps\.cartocdn\.com$/;

/**
 * Appends the key to every CARTO basemap request: style JSON, TileJSON, vector
 * tiles, sprites and glyphs. Passed to MapLibre so it also covers the nested
 * URLs the style resolves for itself, which we never name directly.
 */
export function transformRequest(url: string): RequestParameters {
  if (!CARTO_KEY) return { url };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url };
  }

  if (!CARTO_HOST.test(parsed.hostname) || parsed.searchParams.has('key')) {
    return { url };
  }

  parsed.searchParams.set('key', CARTO_KEY);
  return { url: parsed.toString() };
}
