/**
 * Core domain model. Everything is keyed on ENTSO-E EIC area codes rather than
 * ISO country codes so that a later switch from country-level to bidding-zone
 * level is a data change, not a rewrite.
 */

/** ENTSO-E EIC area code, e.g. "10Y1001A1001A83F" for Germany. */
export type AreaCode = string;

/** ENTSO-E PsrType codes (B01..B25) collapsed into display categories. */
export type ProductionType =
	| "biomass"
	| "lignite"
	| "coal"
	| "gas"
	| "oil"
	| "nuclear"
	| "hydro"
	| "pumpedStorage"
	| "wind"
	| "solar"
	| "geothermal"
	| "waste"
	| "other";

export const PRODUCTION_TYPES: ProductionType[] = [
	"nuclear",
	"hydro",
	"pumpedStorage",
	"wind",
	"solar",
	"biomass",
	"geothermal",
	"waste",
	"gas",
	"coal",
	"lignite",
	"oil",
	"other",
];

/** Whether a production type counts as low-carbon, for the map choropleth. */
const LOW_CARBON: ReadonlySet<ProductionType> = new Set<ProductionType>([
	"nuclear",
	"hydro",
	"pumpedStorage",
	"wind",
	"solar",
	"geothermal",
]);

/** Lifecycle carbon intensity in gCO2eq per kWh, IPCC AR5 medians. */
const CARBON_INTENSITY: Record<ProductionType, number> = {
	biomass: 230,
	lignite: 1054,
	coal: 820,
	gas: 490,
	oil: 650,
	nuclear: 12,
	hydro: 24,
	pumpedStorage: 24,
	wind: 11,
	solar: 45,
	geothermal: 38,
	waste: 300,
	other: 500,
};

/** A generation/load/price snapshot for one area at one instant. */
export interface AreaSnapshot {
	area: AreaCode;
	/** Generation in MW, keyed by production type. Absent types are not reported. */
	generation: Partial<Record<ProductionType, number>>;
	/** Actual total load in MW. Null when the TSO does not publish it. */
	load: number | null;
	/** Day-ahead price in EUR/MWh for the current hour. Null when unavailable. */
	price: number | null;
}

/**
 * Net physical flow across one border, already netted across both directions.
 * `from`/`to` are ordered so that `netMw` is always >= 0: power moves from
 * `from` to `to`. A border with zero flow keeps its canonical ordering.
 */
export interface BorderFlow {
	from: AreaCode;
	to: AreaCode;
	netMw: number;
	/** Raw unidirectional readings, kept for the tooltip. */
	forwardMw: number;
	reverseMw: number;
}

/**
 * Live output of one generation unit, as published per-unit by a TSO.
 * Coverage is a national choice: France publishes ~180 units, Germany none.
 * `name` is the TSO's own unit name, which is what we join to plant
 * coordinates on, since ENTSO-E publishes no location.
 */
export interface UnitOutput {
	/** ENTSO-E EIC code of the generation unit. Unique and stable. */
	eic: string;
	name: string;
	area: AreaCode;
	fuel: ProductionType;
	/** Current output in MW. Negative for a pumping/charging unit. */
	mw: number;
}

/** The complete payload the map renders. */
export interface GridSnapshot {
	/** ISO-8601 instant the underlying data refers to. */
	timestamp: string;
	/** ISO-8601 instant this snapshot was assembled. */
	fetchedAt: string;
	source: "mock" | "entsoe";
	areas: AreaSnapshot[];
	flows: BorderFlow[];
	/** Areas that failed to fetch, so the UI can grey them out honestly. */
	degraded: AreaCode[];
	/**
	 * Per-unit live output, where the TSO publishes it. Absent entirely when
	 * the source cannot supply it; empty for areas that publish nothing.
	 */
	units?: UnitOutput[];
	/** Areas known to publish per-unit data in this snapshot. */
	unitAreas?: AreaCode[];
}

export function totalGeneration(s: AreaSnapshot): number {
	return Object.values(s.generation).reduce<number>((a, b) => a + (b ?? 0), 0);
}

export function carbonIntensity(s: AreaSnapshot): number | null {
	let energy = 0;
	let emissions = 0;
	for (const [type, mw] of Object.entries(s.generation)) {
		if (!mw || mw <= 0) continue;
		energy += mw;
		emissions += mw * CARBON_INTENSITY[type as ProductionType];
	}
	return energy > 0 ? emissions / energy : null;
}

export function lowCarbonShare(s: AreaSnapshot): number | null {
	let total = 0;
	let clean = 0;
	for (const [type, mw] of Object.entries(s.generation)) {
		if (!mw || mw <= 0) continue;
		total += mw;
		if (LOW_CARBON.has(type as ProductionType)) clean += mw;
	}
	return total > 0 ? clean / total : null;
}
