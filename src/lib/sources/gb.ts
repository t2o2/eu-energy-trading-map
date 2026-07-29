/**
 * Great Britain overlay.
 *
 * ENTSO-E publishes almost nothing for GB post-Brexit: the A75 generation, A65
 * load and A44 price queries all answer "no matching data", so on the ENTSO-E
 * feed alone GB is a blank country with only partial flows. Every live GB grid
 * dashboard — grid.iamkate.com, gridwatch.templar.co.uk, energydashboard.co.uk
 * — instead reads the domestic publishers directly, and so do we:
 *
 * - **Elexon Insights (BMRS)** `FUELINST`: transmission-connected generation by
 *   fuel and every interconnector, 5-minutely. No key, no rate limit published.
 * - **Elexon Insights** `INDO`/`ITSDO`: half-hourly demand outturn.
 * - **Sheffield Solar PV_Live**: GB solar, which is almost entirely embedded in
 *   the distribution networks and therefore invisible to Elexon.
 * - **NESO Demand Data Update**: embedded wind, likewise invisible to Elexon.
 * - **Elexon Insights** market index: the GB wholesale price, in £/MWh, which
 *   Yahoo Finance's GBP/EUR rate converts to the euros the panel shows.
 *
 * Elexon data is used under the BMRS copyright licence, which requires the
 * statement: Contains BMRS data © Elexon Limited copyright and database right.
 */
import type { AreaSnapshot, BorderFlow, ProductionType } from "../domain/types";

export const GB_AREA = "10YGB----------A";

const FR = "10YFR-RTE------C";
const IE = "10Y1001A1001A59C";
const NL = "10YNL----------L";
const BE = "10YBE----------2";
const NO = "10YNO-0--------C";
const DK = "10Y1001A1001A65H";

/** Elexon FUELINST fuel types that are generation, mapped to our categories. */
const FUEL_TO_PRODUCTION: Record<string, ProductionType> = {
	BIOMASS: "biomass",
	CCGT: "gas",
	OCGT: "gas",
	COAL: "coal",
	OIL: "oil",
	NUCLEAR: "nuclear",
	WIND: "wind",
	NPSHYD: "hydro",
	PS: "pumpedStorage",
	OTHER: "other",
};

/**
 * Elexon interconnector fuel types, mapped to the area at the far end. A
 * positive reading is an import into GB. Several cables land in the same
 * country (IFA, IFA2 and ElecLink all reach France) and are summed, because
 * the map draws one arrow per border.
 */
const INTERCONNECTOR_TO_AREA: Record<string, string> = {
	INTFR: FR,
	INTIFA2: FR,
	INTELEC: FR,
	INTIRL: IE, // Moyle, to Northern Ireland
	INTEW: IE, // East-West
	INTGRNL: IE, // Greenlink
	INTNED: NL, // BritNed
	INTNEM: BE, // Nemo Link
	INTNSL: NO, // North Sea Link
	INTVKL: DK, // Viking Link
};

/** A reading is only carried forward this long before we call it unknown. */
const MAX_STALENESS_MS = 2 * 3600_000;

interface Sample {
	t: number;
	v: number;
}

/** The newest reading at or before `at`, or null if there is none recent enough. */
function sampleAt(series: Sample[], at: Date): number | null {
	const t = at.getTime();
	let best: Sample | null = null;
	for (const s of series) {
		if (s.t <= t && (best === null || s.t > best.t)) best = s;
	}
	if (best === null || t - best.t > MAX_STALENESS_MS) return null;
	return best.v;
}

async function getJson(url: string): Promise<unknown> {
	const res = await fetch(url, { headers: { Accept: "application/json" } });
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return res.json();
}

function iso(d: Date): string {
	return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The UTC instant a settlement period starts. Periods are contiguous 30-minute
 * intervals counted from local midnight, so on the 46- and 50-period clock
 * change days this arithmetic is still exact.
 */
function settlementStart(settlementDate: string, period: number): number {
	const [y, m, d] = settlementDate.split("-").map(Number);
	const localMidnightUtc = Date.UTC(y, m - 1, d);
	// Europe/London is UTC or UTC+1; measure which by formatting the instant.
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/London",
		hour: "numeric",
		hourCycle: "h23",
	}).formatToParts(new Date(localMidnightUtc));
	const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
	const offsetMs = (hour === 0 ? 0 : hour) * 3600_000;
	return localMidnightUtc - offsetMs + (period - 1) * 30 * 60_000;
}

interface FuelInst {
	startTime: string;
	fuelType: string;
	generation: number;
}

/** Transmission-connected generation and interconnector flows, 5-minutely. */
async function fetchFuelInst(
	from: Date,
	to: Date,
): Promise<Map<string, Sample[]>> {
	const data = (await getJson(
		"https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELINST/stream" +
			`?publishDateTimeFrom=${iso(from)}&publishDateTimeTo=${iso(to)}`,
	)) as FuelInst[];

	const byFuel = new Map<string, Sample[]>();
	for (const row of data) {
		const t = Date.parse(row.startTime);
		if (!Number.isFinite(t) || typeof row.generation !== "number") continue;
		const list = byFuel.get(row.fuelType);
		if (list) list.push({ t, v: row.generation });
		else byFuel.set(row.fuelType, [{ t, v: row.generation }]);
	}
	return byFuel;
}

interface MarketIndex {
	startTime: string;
	price: number;
}

/**
 * GB wholesale price in £/MWh, from the APX (EPEX SPOT UK) market index — the
 * series every GB dashboard quotes. It is a volume-weighted index of
 * short-term trades rather than the day-ahead auction ENTSO-E's A44 carries,
 * so it is comparable with the rest of the map but not identical in
 * definition.
 */
async function fetchPrice(from: Date, to: Date): Promise<Sample[]> {
	const body = (await getJson(
		"https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index" +
			`?from=${iso(from)}&to=${iso(to)}&dataProviders=APXMIDP`,
	)) as { data: MarketIndex[] };

	return body.data
		.map((r) => ({ t: Date.parse(r.startTime), v: r.price }))
		.filter((s) => Number.isFinite(s.t) && typeof s.v === "number");
}

/**
 * GBP/EUR spot rate from Yahoo Finance. The chart endpoint needs no key; the
 * `v7/quote` one now returns 401 unauthorised.
 *
 * One rate is applied across the whole 24 hours. Intraday FX moves a fraction
 * of a percent while the prices themselves swing by multiples, so per-frame
 * rates would add requests and imply a precision the conversion does not have.
 */
async function fetchGbpEur(): Promise<number | null> {
	const res = await fetch(
		"https://query1.finance.yahoo.com/v8/finance/chart/GBPEUR=X?range=1d&interval=1d",
		{ headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
	);
	if (!res.ok) throw new Error(`Yahoo GBPEUR -> ${res.status}`);

	const body = (await res.json()) as {
		chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
	};
	const rate = body.chart?.result?.[0]?.meta?.regularMarketPrice;
	// A nonsensical rate means the shape changed; a wrong number is worse than
	// no price at all, so refuse it rather than quoting pounds as euros.
	if (typeof rate !== "number" || rate <= 0.5 || rate >= 2) return null;
	return rate;
}

interface DemandOutturn {
	startTime: string;
	initialDemandOutturn: number;
}

/**
 * National Demand: metered demand on the transmission system, half-hourly.
 * It nets off embedded generation, so the embedded solar and wind added to the
 * mix below are added back here to keep load comparable to total generation.
 */
async function fetchDemand(from: Date, to: Date): Promise<Sample[]> {
	const day = (d: Date) => d.toISOString().slice(0, 10);
	const body = (await getJson(
		"https://data.elexon.co.uk/bmrs/api/v1/demand/outturn" +
			`?settlementDateFrom=${day(from)}&settlementDateTo=${day(to)}`,
	)) as { data: DemandOutturn[] };

	return body.data
		.map((r) => ({ t: Date.parse(r.startTime), v: r.initialDemandOutturn }))
		.filter((s) => Number.isFinite(s.t) && typeof s.v === "number" && s.v > 0);
}

/**
 * GB solar, from Sheffield Solar's PV_Live national estimate (GSP 0). Nearly
 * all GB solar sits behind distribution grid supply points, so Elexon never
 * sees it: without this the country reads as having no solar at all.
 */
async function fetchSolar(from: Date, to: Date): Promise<Sample[]> {
	const body = (await getJson(
		"https://api.solar.sheffield.ac.uk/pvlive/api/v4/gsp/0" +
			`?start=${iso(from)}&end=${iso(to)}`,
	)) as { data: [number, string, number | null][] };

	return body.data
		.map(([, when, mw]) => ({ t: Date.parse(when), v: mw ?? 0 }))
		.filter((s) => Number.isFinite(s.t));
}

/**
 * Embedded wind, from NESO's Demand Data Update. The file carries settled
 * actuals for elapsed periods and NESO's own forecast for the rest of the day;
 * the actuals lag by several hours, so the newest frames necessarily read the
 * forecast rows. Both are the operator's own numbers and are the only public
 * estimate of distribution-connected wind.
 */
async function fetchEmbeddedWind(): Promise<Sample[]> {
	const res = await fetch(
		"https://api.neso.energy/dataset/7a12172a-939c-404c-b581-a6128b74f588" +
			"/resource/177f6fa4-ae49-4182-81ea-0c6b35f26ca6/download/demanddataupdate.csv",
		{ redirect: "follow" },
	);
	if (!res.ok) throw new Error(`NESO DDU -> ${res.status}`);
	const text = await res.text();

	const lines = text.trim().split(/\r?\n/);
	const header = lines[0].split(",");
	const dateCol = header.indexOf("SETTLEMENT_DATE");
	const periodCol = header.indexOf("SETTLEMENT_PERIOD");
	const windCol = header.indexOf("EMBEDDED_WIND_GENERATION");
	if (dateCol < 0 || periodCol < 0 || windCol < 0) {
		throw new Error("NESO DDU: unexpected columns");
	}

	const out: Sample[] = [];
	for (const line of lines.slice(1)) {
		const cells = line.split(",");
		const period = Number(cells[periodCol]);
		const mw = Number(cells[windCol]);
		if (!Number.isFinite(period) || !Number.isFinite(mw)) continue;
		out.push({ t: settlementStart(cells[dateCol], period), v: mw });
	}
	return out;
}

/** One frame's worth of GB data, or null where nothing recent was published. */
export interface GbOverlay {
	/** Per frame, in the same order as the requested times. */
	areas: (AreaSnapshot | null)[];
	flows: BorderFlow[][];
}

/**
 * Fetch GB generation, demand and interconnector flows for the given frames.
 *
 * Every upstream is optional: a failure degrades that one signal rather than
 * the whole overlay, because a GB with generation but no embedded solar is
 * still far better than the blank country ENTSO-E gives us.
 */
export async function fetchGbOverlay(times: Date[]): Promise<GbOverlay> {
	const from = new Date(times[0].getTime() - MAX_STALENESS_MS);
	const to = new Date(times[times.length - 1].getTime() + 3600_000);

	const [fuel, demand, solar, embeddedWind, price, gbpEur] = await Promise.all([
		fetchFuelInst(from, to),
		fetchDemand(from, to).catch(() => [] as Sample[]),
		fetchSolar(from, to).catch(() => [] as Sample[]),
		fetchEmbeddedWind().catch(() => [] as Sample[]),
		fetchPrice(from, to).catch(() => [] as Sample[]),
		fetchGbpEur().catch(() => null),
	]);

	const areas: (AreaSnapshot | null)[] = [];
	const flows: BorderFlow[][] = [];

	for (const at of times) {
		const generation: Partial<Record<ProductionType, number>> = {};
		let any = false;

		for (const [fuelType, type] of Object.entries(FUEL_TO_PRODUCTION)) {
			const series = fuel.get(fuelType);
			if (!series) continue;
			const mw = sampleAt(series, at);
			if (mw === null) continue;
			any = true;
			// Pumped storage reads negative while pumping; the map shows
			// generation, and a negative slice would corrupt the mix.
			generation[type] = (generation[type] ?? 0) + Math.max(0, mw);
		}

		if (!any) {
			areas.push(null);
			flows.push([]);
			continue;
		}

		const embeddedSolar = sampleAt(solar, at);
		if (embeddedSolar !== null) generation.solar = embeddedSolar;
		const embedded = sampleAt(embeddedWind, at);
		if (embedded !== null) generation.wind = (generation.wind ?? 0) + embedded;

		const nationalDemand = sampleAt(demand, at);
		const load =
			nationalDemand === null
				? null
				: nationalDemand + (embeddedSolar ?? 0) + (embedded ?? 0);

		const gbp = sampleAt(price, at);
		areas.push({
			area: GB_AREA,
			generation,
			load,
			// Elexon publishes in £/MWh and the panel is denominated in euros, so
			// without a rate there is no price we can honestly show.
			price: gbp !== null && gbpEur !== null ? gbp * gbpEur : null,
		});

		const netByArea = new Map<string, number>();
		for (const [fuelType, other] of Object.entries(INTERCONNECTOR_TO_AREA)) {
			const series = fuel.get(fuelType);
			if (!series) continue;
			const mw = sampleAt(series, at);
			if (mw === null) continue;
			netByArea.set(other, (netByArea.get(other) ?? 0) + mw);
		}

		flows.push(
			[...netByArea].map(([other, mw]) =>
				// Positive is an import into GB.
				mw >= 0
					? { from: other, to: GB_AREA, netMw: mw, forwardMw: mw, reverseMw: 0 }
					: {
							from: GB_AREA,
							to: other,
							netMw: -mw,
							forwardMw: -mw,
							reverseMw: 0,
						},
			),
		);
	}

	return { areas, flows };
}
