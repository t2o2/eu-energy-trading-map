import type { StyleSpecification } from 'maplibre-gl';

/**
 * Minimal dark basemap. CARTO's raster tiles need no API key, so the app runs
 * with zero secrets; our own data layers are added on top in FlowMap.
 */
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/{fontstack}/{range}.pbf',
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0b0e14' } },
    { id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.55 } },
  ],
};
