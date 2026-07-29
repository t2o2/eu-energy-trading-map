"use client";

import { useCallback, useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type {
	GeoJSONSource,
	Map as MlMap,
	MapLayerMouseEvent,
	MapMouseEvent,
} from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { BASE_STYLE } from "@/lib/mapStyle";
import { carbonColor, formatMw, FUEL_COLORS, FUEL_LABELS } from "@/lib/theme";
import { destination } from "@/lib/geo";
import { areaName } from "@/lib/domain/areas";
import { carbonIntensity, type GridSnapshot } from "@/lib/domain/types";
import { joinLiveOutput, plantRadius, type PlantProps } from "@/lib/plants";
import "maplibre-gl/dist/maplibre-gl.css";

export interface BorderAnchorProps {
	a: string;
	b: string;
	isoA: string;
	isoB: string;
	bearing: number;
	kind: "land" | "sea";
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
	plants: FeatureCollection<Point, PlantProps> | null;
	showPlants: boolean;
	selected: string | null;
	onSelect: (code: string | null) => void;
}

export default function FlowMap({
	snapshot,
	borders,
	countries,
	plants,
	showPlants,
	selected,
	onSelect,
}: Props) {
	const container = useRef<HTMLDivElement>(null);
	const map = useRef<MlMap | null>(null);
	const ready = useRef(false);
	const phase = useRef(0);
	// Effects can fire before the style finishes loading; queue their work.
	const pending = useRef<(() => void)[]>([]);
	const latest = useRef<{
		snapshot: GridSnapshot | null;
		borders: typeof borders;
	}>({
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
		m.addControl(
			new maplibregl.NavigationControl({ showCompass: false }),
			"bottom-right",
		);

		m.on("load", () => {
			// promoteId keeps string feature ids usable with setFeatureState; without
			// it MapLibre requires numeric ids and silently drops the state.
			m.addSource("countries", {
				type: "geojson",
				data: emptyFc(),
				promoteId: "iso2",
			});
			m.addSource("flows", { type: "geojson", data: emptyFc() });
			m.addSource("pulses", { type: "geojson", data: emptyFc() });
			m.addSource("plants", {
				type: "geojson",
				data: emptyFc(),
				promoteId: "id",
			});

			m.addLayer({
				id: "country-fill",
				type: "fill",
				source: "countries",
				paint: {
					"fill-color": ["coalesce", ["feature-state", "color"], "#20242e"],
					"fill-opacity": [
						"case",
						["boolean", ["feature-state", "selected"], false],
						0.88,
						["boolean", ["feature-state", "hover"], false],
						0.78,
						0.6,
					],
				},
			});

			m.addLayer({
				id: "country-line",
				type: "line",
				source: "countries",
				paint: {
					"line-color": [
						"case",
						["boolean", ["feature-state", "selected"], false],
						"#ffffff",
						"rgba(255,255,255,0.28)",
					],
					"line-width": [
						"case",
						["boolean", ["feature-state", "selected"], false],
						2.2,
						0.6,
					],
				},
			});

			// Flow arrows: a shaft line plus travelling pulses along it.
			m.addLayer({
				id: "flow-line",
				type: "line",
				source: "flows",
				layout: { "line-cap": "round" },
				paint: {
					"line-color": [
						"case",
						["boolean", ["feature-state", "hover"], false],
						"#ffffff",
						["==", ["get", "kind"], "sea"],
						"#7fd8ff",
						"#ffd980",
					],
					"line-width": ["get", "width"],
					"line-opacity": 0.85,
				},
			});

			m.addLayer({
				id: "flow-head",
				type: "symbol",
				source: "flows",
				layout: {
					"icon-image": "flow-arrow",
					"icon-rotate": ["get", "heading"],
					"icon-rotation-alignment": "map",
					"icon-size": ["get", "headSize"],
					"icon-allow-overlap": true,
					"icon-ignore-placement": true,
					"symbol-placement": "point",
				},
			});

			m.addLayer({
				id: "flow-pulse",
				type: "circle",
				source: "pulses",
				paint: {
					"circle-radius": ["get", "r"],
					"circle-color": [
						"case",
						["==", ["get", "kind"], "sea"],
						"#c9f0ff",
						"#fff3d0",
					],
					"circle-opacity": ["get", "opacity"],
					"circle-blur": 0.35,
				},
			});

			// Plants sit above the choropleth but below the flow arrows, which are
			// the primary subject of the map.
			//
			// Two layers, because a plant with live output and one without carry
			// different information: a filled pie wedge means "this much of nameplate
			// is running right now", while a flat shaded dot means "we know this
			// station exists but nobody publishes its output". Rendering the second
			// as a pie at 0% would assert something we do not know.
			m.addLayer(
				{
					id: "plant-dot",
					type: "circle",
					source: "plants",
					layout: { visibility: "none" },
					filter: ["!=", ["get", "live"], true],
					paint: {
						"circle-radius": [
							"interpolate",
							["linear"],
							["zoom"],
							// Keep markers legible when zoomed out without swamping the map.
							3,
							["*", ["get", "radius"], 0.55],
							6,
							["get", "radius"],
						],
						// Same hue as the pies so fuel stays readable, but muted so the
						// eye goes to the stations that carry live data.
						"circle-color": ["get", "color"],
						"circle-opacity": [
							"case",
							["boolean", ["feature-state", "hover"], false],
							0.85,
							0.4,
						],
						"circle-stroke-width": [
							"case",
							["boolean", ["feature-state", "hover"], false],
							1.6,
							0.5,
						],
						"circle-stroke-color": "rgba(0,0,0,0.5)",
					},
				},
				"flow-line",
			);

			m.addLayer(
				{
					id: "plant-pie",
					type: "symbol",
					source: "plants",
					layout: {
						visibility: "none",
						"icon-image": ["get", "icon"],
						"icon-size": [
							"interpolate",
							["linear"],
							["zoom"],
							3,
							["*", ["get", "pieScale"], 0.55],
							6,
							["get", "pieScale"],
						],
						// Plants are point facts, not labels: never drop one for collision.
						"icon-allow-overlap": true,
						"icon-ignore-placement": true,
					},
					filter: ["==", ["get", "live"], true],
				},
				"flow-line",
			);

			m.addImage("flow-arrow", arrowIcon(), { pixelRatio: 2 });
			if (process.env.NODE_ENV !== "production") {
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
			const src = m.getSource("countries") as GeoJSONSource | undefined;
			src?.setData(countries);
		});
	}, [countries, whenReady]);

	useEffect(() => {
		const m = map.current;
		if (!m || !snapshot || !countries) return;

		whenReady(() => {
			const idByCode = new Map(
				countries.features.map((f) => [
					(f.properties as { code?: string })?.code,
					f.id as string,
				]),
			);
			for (const area of snapshot.areas) {
				const id = idByCode.get(area.area);
				if (!id) continue;
				m.setFeatureState(
					{ source: "countries", id },
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
				m.setFeatureState(
					{ source: "countries", id: f.id as string },
					{ selected: code === selected },
				);
			}
		});
	}, [selected, countries, whenReady]);

	// ---- plants: static geometry joined to live per-unit output --------------
	useEffect(() => {
		const m = map.current;
		if (!m || !plants) return;

		whenReady(() => {
			// Pie images are shared by (fuel, 5% bucket, pumping), so a few hundred
			// cover every plant and survive across refreshes.
			const ensureIcon = (color: string, bucket: number, pumping: boolean) => {
				const name = `pie:${color}:${bucket}${pumping ? ":p" : ""}`;
				if (!m.hasImage(name)) {
					m.addImage(name, pieIcon(color, bucket, pumping), { pixelRatio: 2 });
				}
				return name;
			};

			const src = m.getSource("plants") as GeoJSONSource | undefined;
			src?.setData(buildPlants(plants, snapshot, ensureIcon));
		});
	}, [plants, snapshot, whenReady]);

	useEffect(() => {
		const m = map.current;
		if (!m) return;
		whenReady(() => {
			const visibility = showPlants ? "visible" : "none";
			for (const id of ["plant-dot", "plant-pie"]) {
				if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", visibility);
			}
		});
	}, [showPlants, whenReady]);

	// ---- interaction ---------------------------------------------------------
	useEffect(() => {
		const m = map.current;
		if (!m) return;

		let hoveredCountry: string | null = null;
		let hoveredFlow: string | null = null;
		let hoveredPlant: string | null = null;
		const popup = new maplibregl.Popup({
			closeButton: false,
			closeOnClick: false,
			className: "flow-popup",
			offset: 12,
		});

		const onCountryMove = (e: MapLayerMouseEvent) => {
			const f = e.features?.[0];
			if (!f) return;
			if (hoveredCountry && hoveredCountry !== f.id) {
				m.setFeatureState(
					{ source: "countries", id: hoveredCountry },
					{ hover: false },
				);
			}
			hoveredCountry = f.id as string;
			m.setFeatureState(
				{ source: "countries", id: hoveredCountry },
				{ hover: true },
			);
			m.getCanvas().style.cursor = "pointer";
		};

		const onCountryLeave = () => {
			if (hoveredCountry) {
				m.setFeatureState(
					{ source: "countries", id: hoveredCountry },
					{ hover: false },
				);
				hoveredCountry = null;
			}
			m.getCanvas().style.cursor = "";
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
				m.setFeatureState(
					{ source: "flows", id: hoveredFlow },
					{ hover: false },
				);
			}
			hoveredFlow = id;
			m.setFeatureState({ source: "flows", id }, { hover: true });
			m.getCanvas().style.cursor = "crosshair";

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
						`<div class="text-white/40 mt-1">${p.kind === "sea" ? "Subsea interconnector" : "Land border"}</div>`,
				)
				.addTo(m);
		};

		const onFlowLeave = () => {
			if (hoveredFlow) {
				m.setFeatureState(
					{ source: "flows", id: hoveredFlow },
					{ hover: false },
				);
				hoveredFlow = null;
			}
			m.getCanvas().style.cursor = "";
			popup.remove();
		};

		const onPlantMove = (e: MapLayerMouseEvent) => {
			const f = e.features?.[0];
			if (!f) return;
			const id = f.id as string;
			if (hoveredPlant && hoveredPlant !== id) {
				m.setFeatureState(
					{ source: "plants", id: hoveredPlant },
					{ hover: false },
				);
			}
			hoveredPlant = id;
			m.setFeatureState({ source: "plants", id }, { hover: true });
			m.getCanvas().style.cursor = "pointer";

			const p = f.properties as {
				name: string;
				fuel: string;
				fuelLabel: string;
				capacityMw: number;
				area: string;
				year?: number;
				owner?: string;
				live?: boolean;
				liveMw?: number;
				liveUnits?: number;
				areaReports?: boolean;
			};

			// Three distinct states: matched live data, the TSO publishes per-unit
			// data but this plant did not match, or the TSO publishes none at all.
			let liveLine: string;
			if (p.live) {
				const mw = p.liveMw!;
				const pct =
					p.capacityMw > 0 ? Math.round((mw / p.capacityMw) * 100) : 0;
				let headline: string;
				if (mw < -1) {
					// Negative output means the station is drawing from the grid: real
					// pumping for storage, but house load for a thermal plant that is
					// off. Only say "pumping" when the fuel actually supports it.
					const storage = p.fuel === "pumpedStorage";
					headline =
						`<div class="text-sky-300 tabular-nums text-lg">${formatMw(-mw)}` +
						`<span class="text-white/40 text-xs"> consumed &middot; ${
							storage ? "pumping" : "offline, drawing house load"
						}</span></div>`;
				} else if (mw < 1) {
					headline = '<div class="text-white/60 text-lg">Offline</div>';
				} else if (pct > 115) {
					// Output above nameplate means the station grew after WRI's 2021
					// snapshot (Flamanville's EPR), so a percentage would mislead.
					headline =
						`<div class="text-amber-300 tabular-nums text-lg">${formatMw(mw)}` +
						'<span class="text-white/40 text-xs"> now &middot; above recorded capacity</span></div>';
				} else {
					headline =
						`<div class="text-amber-300 tabular-nums text-lg">${formatMw(mw)}` +
						`<span class="text-white/40 text-xs"> now &middot; ${pct}% of capacity</span></div>`;
				}
				liveLine =
					headline +
					'<div class="text-white/35 mt-1 text-[10px]">Live output matched by name' +
					`${p.liveUnits! > 1 ? ` &middot; ${p.liveUnits} units` : ""}</div>`;
			} else if (p.areaReports) {
				liveLine =
					'<div class="text-white/40 mt-1 text-[11px]">No live output matched</div>';
			} else {
				liveLine = `<div class="text-white/40 mt-1 text-[11px]">${areaName(p.area)} does not publish per-unit output</div>`;
			}

			popup
				.setLngLat((f.geometry as Point).coordinates as [number, number])
				.setHTML(
					`<div class="font-medium text-white">${escapeHtml(p.name)}</div>` +
						`<div class="text-white/55 tabular-nums">${p.fuelLabel} &middot; ${formatMw(p.capacityMw)} capacity</div>` +
						liveLine +
						(p.year
							? `<div class="text-white/30 text-[10px]">Commissioned ${p.year}</div>`
							: ""),
				)
				.addTo(m);
		};

		const onPlantLeave = () => {
			if (hoveredPlant) {
				m.setFeatureState(
					{ source: "plants", id: hoveredPlant },
					{ hover: false },
				);
				hoveredPlant = null;
			}
			m.getCanvas().style.cursor = "";
			popup.remove();
		};

		const onBackground = (e: MapMouseEvent) => {
			const hits = m.queryRenderedFeatures(e.point, {
				layers: ["country-fill", "flow-line", "plant-dot", "plant-pie"].filter(
					(l) => m.getLayer(l),
				),
			});
			if (hits.length === 0) onSelect(null);
		};

		m.on("mousemove", "country-fill", onCountryMove);
		m.on("mouseleave", "country-fill", onCountryLeave);
		m.on("click", "country-fill", onCountryClick);
		m.on("mousemove", "flow-line", onFlowMove);
		m.on("mouseleave", "flow-line", onFlowLeave);
		m.on("mousemove", "plant-dot", onPlantMove);
		m.on("mouseleave", "plant-dot", onPlantLeave);
		m.on("mousemove", "plant-pie", onPlantMove);
		m.on("mouseleave", "plant-pie", onPlantLeave);
		m.on("click", onBackground);

		return () => {
			m.off("mousemove", "country-fill", onCountryMove);
			m.off("mouseleave", "country-fill", onCountryLeave);
			m.off("click", "country-fill", onCountryClick);
			m.off("mousemove", "flow-line", onFlowMove);
			m.off("mouseleave", "flow-line", onFlowLeave);
			m.off("mousemove", "plant-dot", onPlantMove);
			m.off("mouseleave", "plant-dot", onPlantLeave);
			m.off("mousemove", "plant-pie", onPlantMove);
			m.off("mouseleave", "plant-pie", onPlantLeave);
			m.off("click", onBackground);
			popup.remove();
		};
	}, [onSelect]);

	// ---- flow geometry + animation ------------------------------------------
	useEffect(() => {
		const m = map.current;
		if (!m || !snapshot || !borders) return;

		whenReady(() => {
			const src = m.getSource("flows") as GeoJSONSource | undefined;
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
			const src = m.getSource("pulses") as GeoJSONSource | undefined;
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
	return { type: "FeatureCollection", features: [] };
}

/** Popup content is user-visible upstream data, so never interpolate it raw. */
function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			]!,
	);
}

/** Pie fill is quantised to 5% steps so the icon cache stays small. */
function pieBucket(fraction: number): number {
	return Math.round(Math.min(1, Math.max(0, fraction)) * 20) / 20;
}

/**
 * Decorate the static plant geometry with fuel colour, marker size and any
 * live output we could match. The join is by name and therefore partial, so
 * every feature records whether it actually matched.
 *
 * `ensureIcon` is called for matched plants only; it registers the pie image
 * with the style on demand and returns its name.
 */
function buildPlants(
	plants: FeatureCollection<Point, PlantProps>,
	snapshot: GridSnapshot | null,
	ensureIcon: (color: string, bucket: number, pumping: boolean) => string,
): FeatureCollection {
	const props = plants.features.map((f) => f.properties);
	const { live } = joinLiveOutput(props, snapshot?.units ?? []);
	const reporting = new Set(snapshot?.unitAreas ?? []);

	return {
		type: "FeatureCollection",
		features: plants.features.map((f) => {
			const p = f.properties;
			const l = live.get(p.id);
			const color = FUEL_COLORS[p.fuel];

			let icon: string | undefined;
			let fraction = 0;
			if (l) {
				// Only genuine storage gets the pumping treatment; a thermal plant
				// reading negative is just idle and drawing its own house load.
				const pumping = l.mw < -1 && p.fuel === "pumpedStorage";
				// Capacity is a 2021 nameplate, so a plant extended since can exceed
				// it; clamp the wedge rather than drawing past a full circle.
				fraction = p.capacityMw > 0 ? Math.abs(l.mw) / p.capacityMw : 0;
				icon = ensureIcon(color, pieBucket(fraction), pumping);
			}

			return {
				type: "Feature" as const,
				id: p.id,
				geometry: f.geometry,
				properties: {
					...p,
					fuelLabel: FUEL_LABELS[p.fuel],
					color,
					radius: plantRadius(p.capacityMw),
					areaReports: reporting.has(p.area),
					live: l !== undefined,
					liveMw: l?.mw ?? 0,
					liveUnits: l?.units ?? 0,
					...(icon ? { icon } : {}),
					// Scale the bitmap so a pie and a plain dot of the same capacity
					// render at identical diameters.
					pieScale: pieScaleFor(plantRadius(p.capacityMw)),
					fraction,
				},
			};
		}),
	};
}

/**
 * Pair each flow with its border anchor, resolving the bearing to the direction
 * power is actually running. The stored bearing points a -> b, so it is
 * reversed when power runs b -> a. Flows without a known anchor are skipped.
 */
function* anchoredFlows(
	snapshot: GridSnapshot,
	borders: FeatureCollection<Point, BorderAnchorProps>,
) {
	const byId = new Map(
		borders.features.map((f) => [`${f.properties.a}|${f.properties.b}`, f]),
	);

	for (const flow of snapshot.flows) {
		const anchor =
			byId.get(`${flow.from}|${flow.to}`) ??
			byId.get(`${flow.to}|${flow.from}`);
		if (!anchor) continue;

		const forward = anchor.properties.a === flow.from;
		yield {
			flow,
			anchor,
			heading: forward
				? anchor.properties.bearing
				: anchor.properties.bearing + 180,
			centre: anchor.geometry.coordinates as [number, number],
		};
	}
}

/**
 * Build one line per border, centred on the precomputed anchor and oriented
 * along the direction power is actually flowing.
 */
function buildFlowLines(
	snapshot: GridSnapshot,
	borders: FeatureCollection<Point, BorderAnchorProps>,
): FeatureCollection {
	const features: FeatureCollection["features"] = [];

	for (const { flow, anchor, heading, centre } of anchoredFlows(
		snapshot,
		borders,
	)) {
		const half = arrowLengthKm(flow.netMw) / 2;
		const tail = destination(centre, half, heading + 180);
		const head = destination(centre, half, heading);

		features.push({
			type: "Feature",
			id: `${flow.from}|${flow.to}`,
			geometry: { type: "LineString", coordinates: [tail, head] },
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
		type: "FeatureCollection",
		features: features.flatMap((f) => {
			const p = f.properties as Record<string, unknown>;
			return [
				f,
				{
					type: "Feature" as const,
					geometry: {
						type: "Point" as const,
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
	const features: FeatureCollection["features"] = [];

	for (const { flow, anchor, heading, centre } of anchoredFlows(
		snapshot,
		borders,
	)) {
		const length = arrowLengthKm(flow.netMw);

		// Bigger flows carry more, faster pulses.
		let count = 1;
		if (flow.netMw > 1500) count = 3;
		else if (flow.netMw > 500) count = 2;
		const speed = 0.6 + Math.min(2.2, flow.netMw / 1200);

		for (let i = 0; i < count; i++) {
			const t = (phase * speed + i / count) % 1;
			const pos = destination(centre, -length / 2 + length * t, heading);
			// Fade in and out at the ends so pulses appear to flow, not blink.
			const fade = Math.sin(Math.PI * t);
			features.push({
				type: "Feature",
				geometry: { type: "Point", coordinates: pos },
				properties: {
					kind: anchor.properties.kind,
					r: 1.6 + Math.min(3.4, Math.sqrt(flow.netMw) / 22),
					opacity: 0.25 + 0.65 * fade,
				},
			});
		}
	}

	return { type: "FeatureCollection", features };
}

/** Pie icons are square bitmaps; everything below is in canvas pixels. */
const PIE_ICON_SIZE = 64;
/** Padding leaves room for the ring stroke so the icon is not clipped. */
const PIE_ICON_PAD = 4;
const PIE_ICON_RADIUS = PIE_ICON_SIZE / 2 - PIE_ICON_PAD;
/** Icons are registered at pixelRatio 2, so canvas px are half a CSS px. */
const PIE_ICON_PIXEL_RATIO = 2;

/**
 * `icon-size` that makes a pie render at exactly the diameter the circle layer
 * would give the same plant, so the two marker styles are directly comparable.
 * The drawn disc is PIE_ICON_RADIUS canvas px, i.e. half that in CSS px.
 */
function pieScaleFor(radiusPx: number): number {
	return radiusPx / (PIE_ICON_RADIUS / PIE_ICON_PIXEL_RATIO);
}

/**
 * Draw a pie marker: a filled wedge showing the share of nameplate capacity a
 * station is currently generating, inside a faint ring of the same fuel colour
 * representing the whole plant.
 *
 * Icons are generated once per (fuel, rounded percentage) pair and cached in
 * the style, so 1,300 plants cost at most a few hundred small images rather
 * than one each.
 */
function pieIcon(color: string, fraction: number, pumping: boolean): ImageData {
	const size = PIE_ICON_SIZE;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const c = size / 2;
	const r = PIE_ICON_RADIUS;

	ctx.clearRect(0, 0, size, size);

	// Outline of the full circle = installed capacity.
	ctx.beginPath();
	ctx.arc(c, c, r, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(8,10,14,0.55)";
	ctx.fill();

	if (fraction > 0.001) {
		// Wedge starts at 12 o'clock and runs clockwise, the convention people
		// already read on gauges.
		ctx.beginPath();
		ctx.moveTo(c, c);
		ctx.arc(
			c,
			c,
			r,
			-Math.PI / 2,
			-Math.PI / 2 + Math.PI * 2 * Math.min(1, fraction),
		);
		ctx.closePath();
		ctx.fillStyle = color;
		ctx.fill();
	}

	ctx.beginPath();
	ctx.arc(c, c, r, 0, Math.PI * 2);
	ctx.lineWidth = 2.5;
	// A pumping unit is consuming, not generating; mark it rather than drawing
	// an empty pie that would read as "idle".
	ctx.strokeStyle = pumping ? "#7fd8ff" : "rgba(255,255,255,0.92)";
	ctx.stroke();

	if (pumping) {
		ctx.beginPath();
		ctx.moveTo(c - r * 0.45, c);
		ctx.lineTo(c + r * 0.45, c);
		ctx.lineWidth = 3;
		ctx.strokeStyle = "#7fd8ff";
		ctx.stroke();
	}

	return ctx.getImageData(0, 0, size, size);
}

/** Small triangular arrowhead drawn once and reused by the symbol layer. */
function arrowIcon(): ImageData {
	const size = 48;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	ctx.clearRect(0, 0, size, size);
	ctx.beginPath();
	// Pointing "up" = bearing 0, which MapLibre rotates by icon-rotate.
	ctx.moveTo(size / 2, 4);
	ctx.lineTo(size - 8, size - 8);
	ctx.lineTo(size / 2, size * 0.68);
	ctx.lineTo(8, size - 8);
	ctx.closePath();
	ctx.fillStyle = "#ffe9a8";
	ctx.fill();
	return ctx.getImageData(0, 0, size, size);
}
