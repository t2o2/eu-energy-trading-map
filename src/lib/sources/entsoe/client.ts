import { XMLParser } from "fast-xml-parser";

const BASE_URL = "https://web-api.tp.entsoe.eu/api";

class EntsoeError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "EntsoeError";
	}
}

/** Raised when ENTSO-E replies "No matching data found" — expected, not a bug. */
export class NoDataError extends EntsoeError {}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	parseTagValue: true,
	removeNSPrefix: true,
});

/** ENTSO-E wants UTC timestamps formatted yyyyMMddHHmm. */
export function formatPeriod(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
		`${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
	);
}

interface Point {
	position: number;
	quantity: number;
}

export interface TimeSeries {
	/** PsrType code (B01..B25) when the document carries generation detail. */
	psrType?: string;
	/** ISO-8601 start of the series period. */
	start: string;
	/** ISO-8601 duration, e.g. "PT15M" or "PT60M". */
	resolution: string;
	points: Point[];
	/** True when the series is the consumption leg of a pumped-storage pair. */
	isConsumption: boolean;
	/** EIC of the generation unit, on per-unit documents (A73/A71). */
	resourceEic?: string;
	/** TSO's name for the generation unit, on per-unit documents. */
	resourceName?: string;
}

function toArray<T>(v: T | T[] | undefined): T[] {
	if (v === undefined || v === null) return [];
	return Array.isArray(v) ? v : [v];
}

/**
 * Read a value that may be a bare string or an element carrying attributes,
 * which fast-xml-parser represents as `{ '#text': ..., '@_codingScheme': ... }`.
 */
function readText(v: unknown): string | undefined {
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
	if (v && typeof v === "object") {
		const t = (v as Record<string, unknown>)["#text"];
		if (typeof t === "string" || typeof t === "number") return String(t);
	}
	return undefined;
}

type XmlNode = Record<string, unknown>;

function parseTimeSeries(doc: XmlNode): TimeSeries[] {
	const root = (doc.GL_MarketDocument ??
		doc.Publication_MarketDocument ??
		doc.Unavailability_MarketDocument) as XmlNode | undefined;
	if (!root) return [];

	const series: TimeSeries[] = [];
	for (const ts of toArray(root.TimeSeries as XmlNode | XmlNode[])) {
		const psrNode = (ts.MktPSRType ?? undefined) as XmlNode | undefined;
		const psrType = psrNode?.["psrType"] as string | undefined;

		// Per-unit documents nest the unit under MktPSRType/PowerSystemResources;
		// the name there is the TSO's own, e.g. "CATTENOM 3".
		const resource = psrNode?.["PowerSystemResources"] as XmlNode | undefined;
		const resourceEic =
			readText(resource?.["mRID"]) ?? readText(ts["registeredResource.mRID"]);
		const resourceName =
			readText(resource?.["name"]) ?? readText(ts["registeredResource.name"]);
		// Pumped storage and battery series appear twice: once as generation
		// (inBiddingZone_Domain) and once as consumption (outBiddingZone_Domain).
		const isConsumption =
			"outBiddingZone_Domain.mRID" in ts &&
			!("inBiddingZone_Domain.mRID" in ts);

		for (const period of toArray(ts.Period as XmlNode | XmlNode[])) {
			const interval = period.timeInterval as XmlNode | undefined;
			const start = interval?.start as string | undefined;
			const resolution = period.resolution as string | undefined;
			if (!start || !resolution) continue;

			const points: Point[] = [];
			for (const pt of toArray(period.Point as XmlNode | XmlNode[])) {
				const position = Number(pt.position);
				const raw = pt.quantity ?? pt["price.amount"];
				const quantity = Number(raw);
				if (Number.isFinite(position) && Number.isFinite(quantity)) {
					points.push({ position, quantity });
				}
			}
			if (points.length > 0) {
				series.push({
					psrType,
					start,
					resolution,
					points,
					isConsumption,
					resourceEic,
					resourceName,
				});
			}
		}
	}
	return series;
}

function resolutionMinutes(resolution: string): number {
	const m = /^PT(\d+)M$/.exec(resolution);
	if (m) return Number(m[1]);
	if (resolution === "PT1H" || resolution === "PT60M") return 60;
	if (resolution === "P1D") return 1440;
	return 60;
}

/**
 * The value of a series as of `at`, i.e. at the latest point not in its future.
 * ENTSO-E omits repeated points, so position N holds until position N+1. Pass
 * a past instant to read history: one query covers the whole lookback window,
 * so replaying it at several instants costs no extra requests.
 */
export function valueAt(ts: TimeSeries, at: Date): number | null {
	const start = Date.parse(ts.start);
	if (!Number.isFinite(start)) return null;
	const step = resolutionMinutes(ts.resolution) * 60_000;
	const elapsed = at.getTime() - start;
	if (elapsed < 0) return null;
	const maxPosition = Math.floor(elapsed / step) + 1;

	let best: Point | null = null;
	for (const p of ts.points) {
		if (
			p.position <= maxPosition &&
			(best === null || p.position > best.position)
		) {
			best = p;
		}
	}
	return best?.quantity ?? null;
}

/**
 * Issue one Transparency Platform query. Retries once on 429/5xx with a short
 * backoff; the caller is responsible for overall concurrency limiting.
 */
export async function query(
	token: string,
	params: Record<string, string>,
	signal?: AbortSignal,
): Promise<TimeSeries[]> {
	const url = new URL(BASE_URL);
	url.searchParams.set("securityToken", token);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

	let lastError: Error | null = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));

		let res: Response;
		try {
			res = await fetch(url, {
				signal,
				headers: { Accept: "application/xml" },
			});
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			continue;
		}

		const body = await res.text();

		if (res.ok) return parseTimeSeries(parser.parse(body) as XmlNode);

		// 400 with a Reason of "No matching data found" is a normal, permanent answer.
		if (res.status === 400 && /no matching data/i.test(body)) {
			throw new NoDataError("No matching data found", 400);
		}
		if (res.status === 401 || res.status === 403) {
			throw new EntsoeError("ENTSO-E rejected the security token", res.status);
		}
		if (res.status !== 429 && res.status < 500) {
			throw new EntsoeError(`ENTSO-E returned ${res.status}`, res.status);
		}
		lastError = new EntsoeError(`ENTSO-E returned ${res.status}`, res.status);
	}
	throw lastError ?? new EntsoeError("ENTSO-E request failed");
}
