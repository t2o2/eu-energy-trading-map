'use client';

import { useCallback, useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { BASE_STYLE } from '@/lib/mapStyle';
import { carbonColor, formatMw } from '@/lib/theme';
import { destination } from '@/lib/geo';
import { areaName } from '@/lib/domain/areas';
import { carbonIntensity, type GridSnapshot } from '@/lib/domain/types';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface BorderAnchorProps {
  a: string;
  b: string;
  isoA: string;
  isoB: string;
  bearing: number;
  kind: 'land' | 'sea';
}

/** Arrow half-length in km, scaled by flow magnitude. */
function arrowLengthKm(mw: number): number {
  return 28 + Math.min(85, Math.sqrt(mw) * 2.6);
}

function arrowWidth(mw: number): number {
  return 1.4 + Math.min(7, Math.sqrt(mw) / 9);
}

interface Props {
  snapshot: GridSnapshot | null;
  borders: FeatureCollection<Point, BorderAnchorProps> | null;
  countries: FeatureCollection | null;
  selected: string | null;
  onSelect: (code: string | null) => void;
}

export default function FlowMap({ snapshot, borders, countries, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const phase = useRef(0);
  // Effects can fire before the style finishes loading; queue their work.
  const pending = useRef<(() => void)[]>([]);
  const latest = useRef<{ snapshot: GridSnapshot | null; borders: typeof borders }>({
    snapshot: null,
    borders: null,
  });

  // The animation loop reads the newest data without being torn down on every
  // refresh, so it is mirrored into a ref from an effect rather than in render.
  useEffect(() => {
    latest.current = { snapshot, borders };
  }, [snapshot, borders]);

  /** Run now if the map is ready, otherwise as soon as it becomes ready. */
  const whenReady = useCallback((fn: () => void) => {
    if (ready.current) fn();
    else pending.current.push(fn);
  }, []);

  // ---- map bootstrap -------------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = new maplibregl.Map({
      container: container.current,
      style: BASE_STYLE,
      center: [10, 53],
      zoom: 3.6,
      minZoom: 2.5,
      maxZoom: 8,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    m.on('load', () => {
      // promoteId keeps string feature ids usable with setFeatureState; without
      // it MapLibre requires numeric ids and silently drops the state.
      m.addSource('countries', { type: 'geojson', data: emptyFc(), promoteId: 'iso2' });
      m.addSource('flows', { type: 'geojson', data: emptyFc() });
      m.addSource('pulses', { type: 'geojson', data: emptyFc() });

      m.addLayer({
        id: 'country-fill',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'color'], '#20242e'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.88,
            ['boolean', ['feature-state', 'hover'], false],
            0.78,
            0.6,
          ],
        },
      });

      m.addLayer({
        id: 'country-line',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#ffffff',
            'rgba(255,255,255,0.28)',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2.2,
            0.6,
          ],
        },
      });

      // Flow arrows: a shaft line plus travelling pulses along it.
      m.addLayer({
        id: 'flow-line',
        type: 'line',
        source: 'flows',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            '#ffffff',
            ['==', ['get', 'kind'], 'sea'],
            '#7fd8ff',
            '#ffd980',
          ],
          'line-width': ['get', 'width'],
          'line-opacity': 0.85,
        },
      });

      m.addLayer({
        id: 'flow-head',
        type: 'symbol',
        source: 'flows',
        layout: {
          'icon-image': 'flow-arrow',
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-size': ['get', 'headSize'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-placement': 'point',
        },
      });

      m.addLayer({
        id: 'flow-pulse',
        type: 'circle',
        source: 'pulses',
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': ['case', ['==', ['get', 'kind'], 'sea'], '#c9f0ff', '#fff3d0'],
          'circle-opacity': ['get', 'opacity'],
          'circle-blur': 0.35,
        },
      });

      m.addImage('flow-arrow', arrowIcon(), { pixelRatio: 2 });
      if (process.env.NODE_ENV !== 'production') {
        (window as unknown as { __map?: MlMap }).__map = m;
      }
      ready.current = true;
      for (const fn of pending.current) fn();
      pending.current = [];
    });

    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
      pending.current = [];
    };
  }, []);

  // ---- country polygons + choropleth --------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !countries) return;

    whenReady(() => {
      const src = m.getSource('countries') as GeoJSONSource | undefined;
      src?.setData(countries);
    });
  }, [countries, whenReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !snapshot || !countries) return;

    whenReady(() => {
      const idByCode = new Map(
        countries.features.map((f) => [(f.properties as { code?: string })?.code, f.id as string]),
      );
      for (const area of snapshot.areas) {
        const id = idByCode.get(area.area);
        if (!id) continue;
        m.setFeatureState(
          { source: 'countries', id },
          { color: carbonColor(carbonIntensity(area)) },
        );
      }
    });
  }, [snapshot, countries, whenReady]);

  // ---- selection + hover state --------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !countries) return;

    whenReady(() => {
      for (const f of countries.features) {
        const code = (f.properties as { code?: string })?.code;
        m.setFeatureState({ source: 'countries', id: f.id as string }, { selected: code === selected });
      }
    });
  }, [selected, countries, whenReady]);

  // ---- interaction ---------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    let hoveredCountry: string | null = null;
    let hoveredFlow: string | null = null;
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'flow-popup',
      offset: 12,
    });

    const onCountryMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      if (hoveredCountry && hoveredCountry !== f.id) {
        m.setFeatureState({ source: 'countries', id: hoveredCountry }, { hover: false });
      }
      hoveredCountry = f.id as string;
      m.setFeatureState({ source: 'countries', id: hoveredCountry }, { hover: true });
      m.getCanvas().style.cursor = 'pointer';
    };

    const onCountryLeave = () => {
      if (hoveredCountry) {
        m.setFeatureState({ source: 'countries', id: hoveredCountry }, { hover: false });
        hoveredCountry = null;
      }
      m.getCanvas().style.cursor = '';
    };

    const onCountryClick = (e: MapLayerMouseEvent) => {
      const code = (e.features?.[0]?.properties as { code?: string })?.code;
      onSelect(code ?? null);
    };

    const onFlowMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = f.id as string;
      if (hoveredFlow && hoveredFlow !== id) {
        m.setFeatureState({ source: 'flows', id: hoveredFlow }, { hover: false });
      }
      hoveredFlow = id;
      m.setFeatureState({ source: 'flows', id }, { hover: true });
      m.getCanvas().style.cursor = 'crosshair';

      const p = f.properties as {
        fromName: string;
        toName: string;
        netMw: number;
        forwardMw: number;
        reverseMw: number;
        kind: string;
      };
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="font-medium text-white">${p.fromName} &rarr; ${p.toName}</div>` +
            `<div class="text-amber-300 tabular-nums text-lg">${formatMw(p.netMw)}</div>` +
            `<div class="text-white/50 tabular-nums">${formatMw(p.forwardMw)} out / ${formatMw(p.reverseMw)} back</div>` +
            `<div class="text-white/40 mt-1">${p.kind === 'sea' ? 'Subsea interconnector' : 'Land border'}</div>`,
        )
        .addTo(m);
    };

    const onFlowLeave = () => {
      if (hoveredFlow) {
        m.setFeatureState({ source: 'flows', id: hoveredFlow }, { hover: false });
        hoveredFlow = null;
      }
      m.getCanvas().style.cursor = '';
      popup.remove();
    };

    const onBackground = (e: MapMouseEvent) => {
      const hits = m.queryRenderedFeatures(e.point, { layers: ['country-fill', 'flow-line'] });
      if (hits.length === 0) onSelect(null);
    };

    m.on('mousemove', 'country-fill', onCountryMove);
    m.on('mouseleave', 'country-fill', onCountryLeave);
    m.on('click', 'country-fill', onCountryClick);
    m.on('mousemove', 'flow-line', onFlowMove);
    m.on('mouseleave', 'flow-line', onFlowLeave);
    m.on('click', onBackground);

    return () => {
      m.off('mousemove', 'country-fill', onCountryMove);
      m.off('mouseleave', 'country-fill', onCountryLeave);
      m.off('click', 'country-fill', onCountryClick);
      m.off('mousemove', 'flow-line', onFlowMove);
      m.off('mouseleave', 'flow-line', onFlowLeave);
      m.off('click', onBackground);
      popup.remove();
    };
  }, [onSelect]);

  // ---- flow geometry + animation ------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !snapshot || !borders) return;

    whenReady(() => {
      const src = m.getSource('flows') as GeoJSONSource | undefined;
      src?.setData(buildFlowLines(snapshot, borders));
    });
  }, [snapshot, borders, whenReady]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const m = map.current;
      const { snapshot: s, borders: b } = latest.current;
      if (!m || !ready.current || !s || !b) return;

      phase.current = (phase.current + 0.006) % 1;
      const src = m.getSource('pulses') as GeoJSONSource | undefined;
      if (src) src.setData(buildPulses(s, b, phase.current));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // maplibre-gl.css forces position:relative on .maplibregl-map, which would
// cancel an absolutely positioned container, so size it with h/w instead.
  return <div ref={container} className="h-full w-full" />;
}

// ---------------------------------------------------------------------------

function emptyFc(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Build one line per border, centred on the precomputed anchor and oriented
 * along the direction power is actually flowing.
 */
function buildFlowLines(
  snapshot: GridSnapshot,
  borders: FeatureCollection<Point, BorderAnchorProps>,
): FeatureCollection {
  const byId = new Map(borders.features.map((f) => [`${f.properties.a}|${f.properties.b}`, f]));
  const features: FeatureCollection['features'] = [];

  for (const flow of snapshot.flows) {
    const anchor = byId.get(`${flow.from}|${flow.to}`) ?? byId.get(`${flow.to}|${flow.from}`);
    if (!anchor) continue;

    // The stored bearing points a -> b; reverse it when power runs b -> a.
    const forward = anchor.properties.a === flow.from;
    const heading = forward ? anchor.properties.bearing : anchor.properties.bearing + 180;

    const centre = anchor.geometry.coordinates as [number, number];
    const half = arrowLengthKm(flow.netMw) / 2;
    const tail = destination(centre, half, heading + 180);
    const head = destination(centre, half, heading);

    features.push({
      type: 'Feature',
      id: `${flow.from}|${flow.to}`,
      geometry: { type: 'LineString', coordinates: [tail, head] },
      properties: {
        from: flow.from,
        to: flow.to,
        fromName: areaName(flow.from),
        toName: areaName(flow.to),
        netMw: flow.netMw,
        forwardMw: flow.forwardMw,
        reverseMw: flow.reverseMw,
        kind: anchor.properties.kind,
        width: arrowWidth(flow.netMw),
        heading,
        headSize: 0.35 + Math.min(0.5, Math.sqrt(flow.netMw) / 110),
        headLon: head[0],
        headLat: head[1],
      },
    });
  }

  // Arrowheads are drawn as a separate point geometry so the symbol sits at
  // the tip rather than the line centroid.
  return {
    type: 'FeatureCollection',
    features: features.flatMap((f) => {
      const p = f.properties as Record<string, unknown>;
      return [
        f,
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [p.headLon as number, p.headLat as number],
          },
          properties: p,
        },
      ];
    }),
  };
}

/** Travelling dots that make direction readable at a glance. */
function buildPulses(
  snapshot: GridSnapshot,
  borders: FeatureCollection<Point, BorderAnchorProps>,
  phase: number,
): FeatureCollection {
  const byId = new Map(borders.features.map((f) => [`${f.properties.a}|${f.properties.b}`, f]));
  const features: FeatureCollection['features'] = [];

  for (const flow of snapshot.flows) {
    const anchor = byId.get(`${flow.from}|${flow.to}`) ?? byId.get(`${flow.to}|${flow.from}`);
    if (!anchor) continue;

    const forward = anchor.properties.a === flow.from;
    const heading = forward ? anchor.properties.bearing : anchor.properties.bearing + 180;
    const centre = anchor.geometry.coordinates as [number, number];
    const length = arrowLengthKm(flow.netMw);

    // Bigger flows carry more, faster pulses.
    const count = flow.netMw > 1500 ? 3 : flow.netMw > 500 ? 2 : 1;
    const speed = 0.6 + Math.min(2.2, flow.netMw / 1200);

    for (let i = 0; i < count; i++) {
      const t = ((phase * speed + i / count) % 1);
      const pos = destination(centre, -length / 2 + length * t, heading);
      // Fade in and out at the ends so pulses appear to flow, not blink.
      const fade = Math.sin(Math.PI * t);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pos },
        properties: {
          kind: anchor.properties.kind,
          r: 1.6 + Math.min(3.4, Math.sqrt(flow.netMw) / 22),
          opacity: 0.25 + 0.65 * fade,
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

/** Small triangular arrowhead drawn once and reused by the symbol layer. */
function arrowIcon(): ImageData {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  // Pointing "up" = bearing 0, which MapLibre rotates by icon-rotate.
  ctx.moveTo(size / 2, 4);
  ctx.lineTo(size - 8, size - 8);
  ctx.lineTo(size / 2, size * 0.68);
  ctx.lineTo(8, size - 8);
  ctx.closePath();
  ctx.fillStyle = '#ffe9a8';
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
