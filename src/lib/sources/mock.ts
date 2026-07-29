import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AREAS, BORDERS } from "../domain/areas";
import { frameTimes, HISTORY_STEP_MINUTES } from "../domain/types";
import type {
	AreaSnapshot,
	BorderFlow,
	GridHistory,
	GridSnapshot,
	ProductionType,
	UnitOutput,
} from "../domain/types";
import type { GridSource } from "./source";

/**
 * Per-country generation fleet, in MW of typical output at full utilisation.
 * These are rough real-world capacity factors applied to real fleets, so the
 * resulting map is recognisably Europe: France nuclear-heavy, Poland on coal,
 * Norway all hydro, Denmark wind-dominated.
 */
interface Fleet {
	load: number; // typical mid-day load, MW
	mix: Partial<Record<ProductionType, number>>; // MW available by type
}

const FLEETS: Record<string, Fleet> = {
	AL: { load: 1100, mix: { hydro: 1600, solar: 120 } },
	AT: {
		load: 8200,
		mix: { hydro: 7000, wind: 2500, gas: 2200, solar: 2400, biomass: 500 },
	},
	BA: { load: 1600, mix: { coal: 1400, hydro: 900, wind: 130 } },
	BE: {
		load: 10500,
		mix: { nuclear: 4000, gas: 5200, wind: 3200, solar: 3500, biomass: 700 },
	},
	BG: {
		load: 4500,
		mix: { nuclear: 2000, lignite: 2200, hydro: 900, wind: 500, solar: 1600 },
	},
	CH: {
		load: 7200,
		mix: { hydro: 8000, nuclear: 2200, solar: 2000, pumpedStorage: 1500 },
	},
	CZ: {
		load: 8000,
		mix: { nuclear: 4000, lignite: 4200, gas: 900, solar: 1800, biomass: 500 },
	},
	DE: {
		load: 62000,
		mix: {
			wind: 42000,
			solar: 30000,
			lignite: 12000,
			coal: 8000,
			gas: 14000,
			biomass: 5500,
			hydro: 3500,
		},
	},
	DK: {
		load: 4200,
		mix: { wind: 6500, solar: 2500, biomass: 1500, coal: 600 },
	},
	EE: { load: 950, mix: { oil: 700, wind: 400, biomass: 200 } },
	ES: {
		load: 30000,
		mix: { wind: 22000, solar: 25000, nuclear: 6000, gas: 12000, hydro: 8000 },
	},
	FI: {
		load: 11000,
		mix: { nuclear: 4400, hydro: 3200, wind: 6000, biomass: 2000 },
	},
	FR: {
		load: 58000,
		mix: { nuclear: 48000, hydro: 12000, wind: 18000, solar: 12000, gas: 6000 },
	},
	GB: {
		load: 34000,
		mix: { wind: 24000, gas: 20000, nuclear: 5000, solar: 9000, biomass: 3000 },
	},
	GR: {
		load: 6500,
		mix: { gas: 4500, wind: 3500, solar: 5000, lignite: 800, hydro: 1500 },
	},
	HR: { load: 2200, mix: { hydro: 1800, wind: 900, gas: 700 } },
	HU: {
		load: 5500,
		mix: { nuclear: 1900, gas: 1800, solar: 4000, lignite: 500 },
	},
	IE: { load: 4800, mix: { wind: 4500, gas: 3500, solar: 700 } },
	IT: {
		load: 38000,
		mix: {
			gas: 25000,
			solar: 20000,
			hydro: 12000,
			wind: 10000,
			geothermal: 800,
			coal: 2000,
		},
	},
	LT: { load: 1500, mix: { wind: 1200, solar: 800, gas: 400, biomass: 200 } },
	LU: { load: 700, mix: { gas: 100, wind: 250, solar: 250 } },
	LV: { load: 1000, mix: { hydro: 1500, gas: 400, wind: 150 } },
	MD: { load: 900, mix: { gas: 900, hydro: 60 } },
	ME: { load: 450, mix: { hydro: 600, lignite: 220, wind: 120 } },
	MK: { load: 1200, mix: { lignite: 700, hydro: 500, gas: 250 } },
	NL: {
		load: 13500,
		mix: { gas: 12000, wind: 9000, solar: 12000, coal: 3000, biomass: 800 },
	},
	NO: { load: 18000, mix: { hydro: 31000, wind: 5000 } },
	PL: {
		load: 22000,
		mix: { coal: 14000, lignite: 7000, wind: 8000, solar: 9000, gas: 3000 },
	},
	PT: { load: 6000, mix: { wind: 5500, hydro: 5000, solar: 3500, gas: 3000 } },
	RO: {
		load: 7500,
		mix: {
			nuclear: 1300,
			hydro: 4000,
			coal: 1800,
			gas: 2000,
			wind: 3000,
			solar: 1500,
		},
	},
	RS: { load: 5500, mix: { lignite: 3800, hydro: 2000, wind: 500 } },
	SE: {
		load: 18000,
		mix: { hydro: 14000, nuclear: 6500, wind: 12000, biomass: 1500 },
	},
	SI: {
		load: 1600,
		mix: { nuclear: 700, hydro: 1000, lignite: 500, solar: 700 },
	},
	SK: { load: 3400, mix: { nuclear: 2400, hydro: 900, gas: 500, solar: 500 } },
	TR: {
		load: 42000,
		mix: {
			gas: 22000,
			coal: 18000,
			hydro: 20000,
			wind: 11000,
			solar: 10000,
			geothermal: 1600,
		},
	},
	UA: {
		load: 14000,
		mix: { nuclear: 7000, coal: 5000, hydro: 3000, solar: 5000, wind: 1500 },
	},
	XK: { load: 900, mix: { lignite: 900, hydro: 100, wind: 130 } },
};

/** Deterministic hash so a given (seed, key) always yields the same jitter. */
function hash(seed: number, key: string): number {
	let h = seed >>> 0;
	for (let i = 0; i < key.length; i++) {
		h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
	}
	return h / 0xffffffff;
}

/** Solar output as a fraction of capacity, by local solar hour and latitude. */
function solarFactor(
	hourUtc: number,
	lonOffsetHours: number,
	month: number,
): number {
	const localHour = hourUtc + lonOffsetHours;
	const seasonal = 0.55 + 0.45 * Math.cos(((month - 6) / 12) * 2 * Math.PI);
	const day = Math.cos(((localHour - 13) / 24) * 2 * Math.PI);
	return Math.max(0, day) ** 2 * seasonal;
}

/** Load follows a two-peak daily curve: morning ramp and evening peak. */
function loadFactor(hourUtc: number, lonOffsetHours: number): number {
	const h = (((hourUtc + lonOffsetHours) % 24) + 24) % 24;
	const morning = Math.exp(-(((h - 9) / 3) ** 2));
	const evening = Math.exp(-(((h - 19) / 3) ** 2));
	return 0.72 + 0.16 * morning + 0.22 * evening;
}

/** Rough longitude in hours from UTC, for the diurnal curves. */
const LON_HOURS: Record<string, number> = {
	PT: -0.6,
	IE: -0.5,
	GB: 0,
	ES: -0.2,
	FR: 0.15,
	BE: 0.3,
	NL: 0.35,
	LU: 0.4,
	CH: 0.5,
	IT: 0.8,
	DE: 0.7,
	DK: 0.7,
	NO: 0.7,
	SE: 1.0,
	AT: 0.9,
	SI: 1.0,
	HR: 1.05,
	CZ: 1.0,
	PL: 1.3,
	HU: 1.3,
	SK: 1.3,
	BA: 1.2,
	ME: 1.3,
	RS: 1.4,
	AL: 1.3,
	XK: 1.4,
	MK: 1.5,
	GR: 1.55,
	BG: 1.7,
	RO: 1.7,
	MD: 1.9,
	UA: 2.0,
	FI: 1.7,
	EE: 1.7,
	LV: 1.6,
	LT: 1.6,
	TR: 2.3,
};

/**
 * Areas the mock pretends publish per-unit data. Chosen to mirror the real
 * patchiness of ENTSO-E's A73 coverage rather than implying every TSO reports.
 */
const MOCK_UNIT_AREAS = new Set([
	"FR",
	"ES",
	"IT",
	"PL",
	"CZ",
	"BE",
	"NL",
	"FI",
	"SE",
	"PT",
]);

interface PlantFeature {
	properties: {
		id: string;
		name: string;
		area: string;
		iso2: string;
		fuel: ProductionType;
		capacityMw: number;
	};
}

let plantCache: PlantFeature[] | null = null;

/**
 * Read the precomputed plant list so simulated per-unit output lines up with
 * the markers actually on the map. A missing file is not fatal: the plant
 * layer then shows capacity with no live overlay.
 */
async function loadPlants(): Promise<PlantFeature[]> {
	if (plantCache) return plantCache;
	try {
		const raw = await readFile(
			join(process.cwd(), "public/geo/plants.json"),
			"utf8",
		);
		plantCache = (JSON.parse(raw) as { features: PlantFeature[] }).features;
	} catch {
		plantCache = [];
	}
	return plantCache;
}

export class MockSource implements GridSource {
	readonly name = "mock" as const;

	async fetchSnapshot(): Promise<GridSnapshot> {
		return this.frameAt(new Date());
	}

	/**
	 * The simulation is a pure function of the instant, so history is simply the
	 * same generator evaluated at each frame time.
	 */
	async fetchHistory(): Promise<GridHistory> {
		const frames = await Promise.all(
			frameTimes(new Date()).map((at) => this.frameAt(at)),
		);
		return { stepMinutes: HISTORY_STEP_MINUTES, frames };
	}

	private async frameAt(now: Date): Promise<GridSnapshot> {
		// Reseed every 15 minutes so the map visibly moves but stays stable within
		// a refresh cycle, matching ENTSO-E's publication cadence.
		const seed = Math.floor(now.getTime() / (15 * 60_000));
		const hourUtc = now.getUTCHours() + now.getUTCMinutes() / 60;
		const month = now.getUTCMonth() + 1;

		const areas: AreaSnapshot[] = [];
		const netPosition = new Map<string, number>();

		for (const area of AREAS) {
			const fleet = FLEETS[area.iso2];
			if (!fleet) continue;
			const lon = LON_HOURS[area.iso2] ?? 1;

			const load = Math.round(
				fleet.load *
					loadFactor(hourUtc, lon) *
					(0.95 + 0.1 * hash(seed, area.iso2 + "L")),
			);

			// Wind is regionally correlated: neighbours share a weather front.
			const windRegion = hash(
				seed,
				`wind:${Math.round((LON_HOURS[area.iso2] ?? 1) * 2)}`,
			);
			const windLocal = hash(seed, area.iso2 + "W");
			const wind = 0.15 + 0.7 * (0.65 * windRegion + 0.35 * windLocal);
			const sun =
				solarFactor(hourUtc, lon, month) *
				(0.6 + 0.4 * hash(seed, area.iso2 + "S"));

			const generation: Partial<Record<ProductionType, number>> = {};
			for (const [t, capacity] of Object.entries(fleet.mix) as [
				ProductionType,
				number,
			][]) {
				let factor: number;
				switch (t) {
					case "wind":
						factor = wind;
						break;
					case "solar":
						factor = sun;
						break;
					case "nuclear":
						factor = 0.82 + 0.12 * hash(seed, area.iso2 + t);
						break;
					case "hydro":
						factor = 0.35 + 0.3 * hash(seed, area.iso2 + t);
						break;
					case "biomass":
					case "geothermal":
					case "waste":
						factor = 0.7;
						break;
					case "pumpedStorage":
						factor = Math.max(0, 0.5 - sun) * hash(seed, area.iso2 + t);
						break;
					default:
						factor = 0.25 + 0.45 * hash(seed, area.iso2 + t);
						break; // thermal follows residual demand
				}
				const mw = Math.round(capacity * factor);
				if (mw > 0) generation[t] = mw;
			}

			// Scale dispatchable thermal so total generation lands near load, which
			// is what a real balancing area does.
			const total = Object.values(generation).reduce<number>(
				(a, b) => a + (b ?? 0),
				0,
			);
			const target = load * (0.9 + 0.2 * hash(seed, area.iso2 + "T"));
			const thermal: ProductionType[] = ["gas", "coal", "lignite", "oil"];
			const thermalTotal = thermal.reduce(
				(a, t) => a + (generation[t] ?? 0),
				0,
			);
			if (thermalTotal > 0) {
				const adjust = Math.max(
					0.05,
					Math.min(2.2, 1 + (target - total) / thermalTotal),
				);
				for (const t of thermal) {
					const mw = generation[t];
					if (mw) generation[t] = Math.round(mw * adjust);
				}
			}

			const gen = Object.values(generation).reduce<number>(
				(a, b) => a + (b ?? 0),
				0,
			);
			const price =
				Math.round(
					(12 +
						180 * Math.max(0, 1 - gen / Math.max(load, 1)) +
						45 * hash(seed, area.iso2 + "P")) *
						10,
				) / 10;

			areas.push({ area: area.code, generation, load, price });
			netPosition.set(area.code, gen - load);
		}

		// Turn each country's surplus/deficit into border flows: every border moves
		// power from the country with the higher surplus to the lower one.
		const flows: BorderFlow[] = [];
		for (const border of BORDERS) {
			const na = netPosition.get(border.a);
			const nb = netPosition.get(border.b);
			if (na === undefined || nb === undefined) continue;

			const gradient = (na - nb) / 2;
			const capacity = 600 + 2400 * hash(seed, border.isoA + border.isoB + "C");
			const noise = (hash(seed, border.isoA + border.isoB) - 0.5) * 300;
			const signed = Math.max(
				-capacity,
				Math.min(capacity, gradient * 0.28 + noise),
			);
			const mw = Math.round(Math.abs(signed));
			if (mw < 15) continue;

			// A real border almost always has some counter-flow from bilateral trades.
			const counter = Math.round(
				mw * 0.12 * hash(seed, border.isoA + border.isoB + "R"),
			);
			flows.push(
				signed >= 0
					? {
							from: border.a,
							to: border.b,
							netMw: mw,
							forwardMw: mw + counter,
							reverseMw: counter,
						}
					: {
							from: border.b,
							to: border.a,
							netMw: mw,
							forwardMw: mw + counter,
							reverseMw: counter,
						},
			);
		}

		// Simulated per-unit output, so the plant layer behaves the same with and
		// without a token. Each plant runs at a factor consistent with its fuel.
		const plants = await loadPlants();
		const unitAreaCodes = AREAS.filter((a) => MOCK_UNIT_AREAS.has(a.iso2)).map(
			(a) => a.code,
		);
		const unitAreaSet = new Set(unitAreaCodes);
		const units: UnitOutput[] = [];

		for (const { properties: p } of plants) {
			if (!unitAreaSet.has(p.area)) continue;
			const lon = LON_HOURS[p.iso2] ?? 1;
			const r = hash(seed, p.id);

			let factor: number;
			switch (p.fuel) {
				case "solar":
					factor = solarFactor(hourUtc, lon, month) * (0.7 + 0.3 * r);
					break;
				case "wind":
					factor = 0.15 + 0.7 * hash(seed, p.iso2 + "W");
					break;
				case "nuclear":
					factor = r < 0.12 ? 0 : 0.85 + 0.13 * r;
					break; // some units on outage
				case "hydro":
					factor = 0.25 + 0.45 * r;
					break;
				case "pumpedStorage":
					factor = r < 0.4 ? -(0.2 + 0.5 * r) : 0.3 + 0.5 * r;
					break;
				case "biomass":
				case "geothermal":
				case "waste":
					factor = 0.6 + 0.3 * r;
					break;
				default:
					factor = r < 0.25 ? 0 : 0.2 + 0.6 * r;
					break;
			}

			units.push({
				eic: `MOCK-${p.id}`,
				name: p.name,
				area: p.area,
				fuel: p.fuel,
				mw: Math.round(p.capacityMw * factor * 10) / 10,
			});
		}

		return {
			timestamp: now.toISOString(),
			fetchedAt: now.toISOString(),
			source: "mock",
			areas,
			flows,
			degraded: [],
			units,
			unitAreas: unitAreaCodes,
		};
	}
}
