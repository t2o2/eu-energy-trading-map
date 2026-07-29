"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection, Point } from "geojson";
import type { GridHistory } from "@/lib/domain/types";
import { formatMw } from "@/lib/theme";
import type { PlantProps, PlantsMetadata } from "@/lib/plants";
import { asset } from "@/lib/basePath";
import type { BorderAnchorProps } from "./FlowMap";
import CountryPanel from "./CountryPanel";
import Legend from "./Legend";
import TimeSlider from "./TimeSlider";

// MapLibre touches window/document at import time.
const FlowMap = dynamic(() => import("./FlowMap"), { ssr: false });

const REFRESH_MS = 5 * 60_000;

export default function MapView() {
	const [history, setHistory] = useState<GridHistory | null>(null);
	// Index into history.frames; null means "stay on the newest frame", so a
	// background refresh advances the map instead of pinning it to a stale hour.
	const [frame, setFrame] = useState<number | null>(null);
	const [playing, setPlaying] = useState(false);
	const [countries, setCountries] = useState<FeatureCollection | null>(null);
	const [borders, setBorders] = useState<FeatureCollection<
		Point,
		BorderAnchorProps
	> | null>(null);
	const [plants, setPlants] = useState<
		(FeatureCollection<Point, PlantProps> & { metadata: PlantsMetadata }) | null
	>(null);
	const [showPlants, setShowPlants] = useState(true);
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		Promise.all([
			fetch(asset("/geo/countries.json")).then((r) => r.json()),
			fetch(asset("/geo/borders.json")).then((r) => r.json()),
		])
			.then(([c, b]) => {
				setCountries(c);
				setBorders(b);
			})
			.catch(() => setError("Failed to load map geometry"));

		// Plants are an optional layer: a failure here must not break the map.
		fetch(asset("/geo/plants.json"))
			.then((r) => (r.ok ? r.json() : null))
			.then(setPlants)
			.catch(() => setPlants(null));
	}, []);

	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			try {
				// Regenerated hourly by the deploy workflow; cache-busted so a
				// long-lived tab still picks up new builds.
				const res = await fetch(
					`${asset("/data/snapshot.json")}?t=${Date.now()}`,
				);
				if (!res.ok) throw new Error(`snapshot ${res.status}`);
				const data: GridHistory = await res.json();
				if (!cancelled) {
					setHistory(data);
					setError(null);
				}
			} catch {
				if (!cancelled) setError("Could not reach the data service");
			}
		};

		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	const onSelect = useCallback((code: string | null) => setSelected(code), []);

	const frames = history?.frames;
	const latest = frames ? frames.length - 1 : 0;
	const index = frame ?? latest;
	const snapshot = frames?.[Math.min(index, latest)] ?? null;

	const onScrub = useCallback(
		(next: (prev: number) => number) => {
			setFrame((prev) => next(prev ?? latest));
		},
		[latest],
	);

	const frameTimes = useMemo(
		() => frames?.map((f) => f.timestamp) ?? [],
		[frames],
	);

	const totals = useMemo(() => {
		if (!snapshot) return null;
		const gen = snapshot.areas.reduce(
			(a, s) =>
				a +
				Object.values(s.generation).reduce<number>((x, y) => x + (y ?? 0), 0),
			0,
		);
		const load = snapshot.areas.reduce((a, s) => a + (s.load ?? 0), 0);
		const traded = snapshot.flows.reduce((a, f) => a + f.netMw, 0);
		return { gen, load, traded, borders: snapshot.flows.length };
	}, [snapshot]);

	return (
		<div className="relative h-full w-full">
			<FlowMap
				snapshot={snapshot}
				borders={borders}
				countries={countries}
				plants={plants}
				showPlants={showPlants}
				selected={selected}
				onSelect={onSelect}
			/>

			<header className="pointer-events-none absolute left-5 top-5 z-20 rounded-lg border border-white/10 bg-[#0d1017]/90 px-4 py-3 backdrop-blur">
				<h1 className="text-sm font-semibold tracking-wide text-white">
					European Power Trading
				</h1>
				<p className="mt-0.5 text-[11px] text-white/45">
					Live cross-border physical flows and generation mix
				</p>

				{totals && (
					<div className="mt-3 flex gap-4 text-[11px]">
						<Metric label="Generation" value={formatMw(totals.gen)} />
						<Metric label="Load" value={formatMw(totals.load)} />
						<Metric label="Traded" value={formatMw(totals.traded)} />
						<Metric label="Borders" value={String(totals.borders)} />
					</div>
				)}

				{snapshot && (
					<p className="mt-2 text-[10px] text-white/35">
						{new Date(snapshot.timestamp).toUTCString().replace("GMT", "UTC")}
						{index < latest && " · historic"}
						{snapshot.degraded.length > 0 &&
							` · ${snapshot.degraded.length} areas unavailable`}
					</p>
				)}
				{!snapshot && !error && (
					<p className="mt-2 text-[10px] text-white/35">Loading…</p>
				)}
				{error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
			</header>

			{snapshot && (
				<Legend
					source={snapshot.source}
					showPlants={showPlants}
					onTogglePlants={() => setShowPlants((v) => !v)}
					plantCount={plants?.metadata.count ?? 0}
					plantVintage={plants?.metadata.vintage}
					liveUnits={snapshot.units?.length ?? 0}
					reportingAreas={snapshot.unitAreas?.length ?? 0}
				/>
			)}

			{snapshot && selected && (
				<CountryPanel
					snapshot={snapshot}
					code={selected}
					onClose={() => setSelected(null)}
				/>
			)}

			{frames && (
				<TimeSlider
					times={frameTimes}
					index={index}
					onChange={onScrub}
					playing={playing}
					onTogglePlay={() => setPlaying((v) => !v)}
				/>
			)}
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="text-[9px] uppercase tracking-wide text-white/35">
				{label}
			</div>
			<div className="tabular-nums text-white/90">{value}</div>
		</div>
	);
}
