"use client";

import { CARBON_STOPS, FUEL_COLORS, FUEL_LABELS } from "@/lib/theme";
import type { ProductionType } from "@/lib/domain/types";

/** A miniature pie showing how the live-output markers are filled. */
function PieSwatch({ fraction }: { fraction: number }) {
	const r = 5;
	const angle = 2 * Math.PI * fraction;
	const x = 6 + r * Math.sin(angle);
	const y = 6 - r * Math.cos(angle);
	return (
		<svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden="true">
			<circle cx="6" cy="6" r={r} fill="rgba(8,10,14,0.55)" />
			<path
				d={`M6 6 L6 ${6 - r} A ${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y} Z`}
				fill={FUEL_COLORS.nuclear}
			/>
			<circle
				cx="6"
				cy="6"
				r={r}
				fill="none"
				stroke="rgba(255,255,255,0.92)"
				strokeWidth="1"
			/>
		</svg>
	);
}

/** Fuels worth a legend swatch, in the order they appear at 100 MW and above. */
const LEGEND_FUELS: ProductionType[] = [
	"nuclear",
	"gas",
	"coal",
	"hydro",
	"wind",
	"solar",
	"biomass",
	"oil",
];

interface Props {
	source: "mock" | "entsoe";
	showPlants: boolean;
	onTogglePlants: () => void;
	plantCount: number;
	plantVintage?: string;
	liveUnits: number;
	reportingAreas: number;
}

export default function Legend({
	source,
	showPlants,
	onTogglePlants,
	plantCount,
	plantVintage,
	liveUnits,
	reportingAreas,
}: Props) {
	return (
		<div className="pointer-events-auto absolute bottom-6 left-5 z-20 max-h-[calc(100dvh-3rem)] w-60 overflow-y-auto rounded-lg border border-white/10 bg-[#0d1017]/90 p-3 text-xs backdrop-blur">
			<div className="mb-1 font-medium text-white/70">Carbon intensity</div>
			<div className="flex h-2 overflow-hidden rounded-full">
				{CARBON_STOPS.map(([stop, color]) => (
					<div key={stop} className="flex-1" style={{ background: color }} />
				))}
			</div>
			<div className="mt-1 flex justify-between text-[10px] text-white/40">
				<span>0</span>
				<span>gCO₂eq/kWh</span>
				<span>900+</span>
			</div>

			<div className="mt-3 border-t border-white/10 pt-2">
				<div className="mb-1.5 font-medium text-white/70">Flows</div>
				<div className="flex items-center gap-2 text-white/55">
					<span className="h-0.5 w-6 rounded bg-[#ffd980]" />
					<span>Land border</span>
				</div>
				<div className="mt-1 flex items-center gap-2 text-white/55">
					<span className="h-0.5 w-6 rounded bg-[#7fd8ff]" />
					<span>Subsea cable</span>
				</div>
				<div className="mt-1.5 text-[10px] text-white/35">
					Arrow length and thickness scale with MW. Pulses show direction.
				</div>
			</div>

			<div className="mt-3 border-t border-white/10 pt-2">
				<label className="flex cursor-pointer items-center justify-between">
					<span className="font-medium text-white/70">Power stations</span>
					<input
						type="checkbox"
						checked={showPlants}
						onChange={onTogglePlants}
						className="h-3 w-3 cursor-pointer accent-amber-400"
					/>
				</label>

				{showPlants && plantCount > 0 && (
					<>
						<div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
							{LEGEND_FUELS.map((f) => (
								<div
									key={f}
									className="flex items-center gap-1.5 text-[10px] text-white/55"
								>
									<span
										className="h-2 w-2 shrink-0 rounded-full"
										style={{ background: FUEL_COLORS[f] }}
									/>
									<span className="truncate">{FUEL_LABELS[f]}</span>
								</div>
							))}
						</div>

						<div className="mt-2 space-y-1">
							<div className="flex items-center gap-1.5 text-[10px] text-white/50">
								<PieSwatch fraction={0.65} />
								<span>Filled share = output vs capacity</span>
							</div>
							<div className="flex items-center gap-1.5 text-[10px] text-white/50">
								<span
									className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/50"
									style={{ background: FUEL_COLORS.gas, opacity: 0.4 }}
								/>
								<span>Flat dot = no live data</span>
							</div>
						</div>
						<div className="mt-1.5 text-[10px] leading-snug text-white/35">
							Marker size scales with capacity. {plantCount} stations ≥ 100 MW.
						</div>

						{/* Provenance matters but is long; keep it one click away. */}
						<details className="mt-1 group">
							<summary className="cursor-pointer list-none text-[10px] text-white/30 hover:text-white/50">
								{reportingAreas > 0
									? `${liveUnits} live units · ${reportingAreas} countries`
									: "No live per-unit data"}
								<span className="ml-1 group-open:hidden">▸</span>
								<span className="ml-1 hidden group-open:inline">▾</span>
							</summary>
							<div className="mt-1 text-[10px] leading-snug text-white/30">
								Locations from WRI GPPD
								{plantVintage ? ` (${plantVintage})` : ""}, so plants built or
								closed since are missing. Live output is ENTSO-E per-unit data
								joined by station name; most TSOs publish none.
							</div>
						</details>
					</>
				)}
			</div>

			{source === "entsoe" && (
				/* Elexon's BMRS licence requires this statement wherever its data
				   is shown; the other GB publishers ask only for credit. */
				<div className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-snug text-white/30">
					GB figures from Elexon Insights, Sheffield Solar PV_Live and NESO,
					since ENTSO-E no longer publishes them. Contains BMRS data © Elexon
					Limited copyright and database right.
				</div>
			)}

			{source === "mock" && (
				<div className="mt-3 rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] leading-snug text-amber-200/90">
					Simulated data. Set{" "}
					<code className="text-amber-100">ENTSOE_TOKEN</code> to switch to live
					ENTSO-E figures.
				</div>
			)}
		</div>
	);
}
