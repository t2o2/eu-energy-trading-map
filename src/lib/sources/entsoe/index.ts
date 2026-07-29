import pLimit from "p-limit";
import { AREAS, BORDERS } from "../../domain/areas";
import {
	frameTimes,
	HISTORY_HOURS,
	HISTORY_STEP_MINUTES,
} from "../../domain/types";
import type {
	AreaSnapshot,
	BorderFlow,
	GridHistory,
	GridSnapshot,
	ProductionType,
	UnitOutput,
} from "../../domain/types";
import type { GridSource } from "../source";
import { formatPeriod, NoDataError, query, valueAt } from "./client";
import { PSR_TO_PRODUCTION } from "./psr";

/**
 * ENTSO-E publishes with a lag and some TSOs are slower than others, so the
 * window reaches back past the history itself. One query returns the whole
 * period, so a day of history costs exactly as many requests as a single
 * instant did — only the stored payload grows.
 */
const LOOKBACK_HOURS = HISTORY_HOURS + 6;

/**
 * ~180 border calls plus ~110 area calls and ~37 per-unit calls per refresh,
 * against a documented limit of 400 requests/minute per token. Ten in flight
 * keeps us well under it while still completing a cold refresh in seconds.
 */
const CONCURRENCY = 10;

function window(now: Date): { periodStart: string; periodEnd: string } {
	const start = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000);
	// Ask slightly into the future so the current interval is always included.
	const end = new Date(now.getTime() + 3600_000);
	return { periodStart: formatPeriod(start), periodEnd: formatPeriod(end) };
}

/** Resolve a query to a value, treating "no data" as null. */
async function scalar<T>(
	fn: () => Promise<T | null>,
	onError: (err: unknown) => void,
): Promise<T | null> {
	try {
		return await fn();
	} catch (err) {
		if (!(err instanceof NoDataError)) onError(err);
		return null;
	}
}

export class EntsoeSource implements GridSource {
	readonly name = "entsoe" as const;

	constructor(private readonly token: string) {}

	async fetchSnapshot(): Promise<GridSnapshot> {
		const history = await this.fetchHistory();
		return history.frames[history.frames.length - 1];
	}

	async fetchHistory(): Promise<GridHistory> {
		const now = new Date();
		const times = frameTimes(now);
		const { periodStart, periodEnd } = window(now);
		const limit = pLimit(CONCURRENCY);
		const degraded = new Set<string>();

		const areaTasks = AREAS.map((area) =>
			limit(async () => {
				// One value per frame, in the same order as `times`.
				const generation = times.map(
					(): Partial<Record<ProductionType, number>> => ({}),
				);

				// A75: actual generation per production type.
				await scalar(
					async () => {
						const series = await query(this.token, {
							documentType: "A75",
							processType: "A16",
							in_Domain: area.code,
							periodStart,
							periodEnd,
						});
						for (const ts of series) {
							if (!ts.psrType || ts.isConsumption) continue;
							const type = PSR_TO_PRODUCTION[ts.psrType];
							if (!type) continue;
							times.forEach((at, i) => {
								const v = valueAt(ts, at);
								if (v === null) return;
								generation[i][type] = (generation[i][type] ?? 0) + v;
							});
						}
						return 0;
					},
					() => degraded.add(area.code),
				);

				// A65 / A16: actual total load.
				const load = await scalar(
					async () => {
						const series = await query(this.token, {
							documentType: "A65",
							processType: "A16",
							outBiddingZone_Domain: area.code,
							periodStart,
							periodEnd,
						});
						return times.map((at) => {
							const values = series
								.map((ts) => valueAt(ts, at))
								.filter((v): v is number => v !== null);
							return values.length ? values.reduce((a, b) => a + b, 0) : null;
						});
					},
					() => degraded.add(area.code),
				);

				// A44: day-ahead prices. Many areas have none; that is not degradation.
				const price = await scalar(
					async () => {
						const series = await query(this.token, {
							documentType: "A44",
							in_Domain: area.code,
							out_Domain: area.code,
							periodStart,
							periodEnd,
						});
						return times.map((at) => {
							for (const ts of series) {
								const v = valueAt(ts, at);
								if (v !== null) return v;
							}
							return null;
						});
					},
					() => undefined,
				);

				return times.map(
					(_, i): AreaSnapshot => ({
						area: area.code,
						generation: generation[i],
						load: load?.[i] ?? null,
						price: price?.[i] ?? null,
					}),
				);
			}),
		);

		const flowTasks = BORDERS.map((border) =>
			limit(async () => {
				const read = (from: string, to: string) =>
					scalar(
						async () => {
							const series = await query(this.token, {
								documentType: "A11",
								in_Domain: to,
								out_Domain: from,
								periodStart,
								periodEnd,
							});
							return times.map((at) => {
								for (const ts of series) {
									const v = valueAt(ts, at);
									if (v !== null) return v;
								}
								return null;
							});
						},
						() => undefined,
					);

				const [ab, ba] = await Promise.all([
					read(border.a, border.b),
					read(border.b, border.a),
				]);

				return times.map((_, i) => {
					const forward = ab?.[i] ?? null;
					const reverse = ba?.[i] ?? null;
					if (forward === null && reverse === null) return null;
					return netFlow(border.a, border.b, forward ?? 0, reverse ?? 0);
				});
			}),
		);

		// A73: actual generation per unit. Only some TSOs publish it; areas that
		// return "no matching data" are simply absent from unitAreas.
		const unitAreas: string[] = [];
		const unitTasks = AREAS.map((area) =>
			limit(async () => {
				const units = await scalar(
					async () => {
						const series = await query(this.token, {
							documentType: "A73",
							processType: "A16",
							in_Domain: area.code,
							periodStart,
							periodEnd,
						});

						return times.map((at) => {
							// One unit can appear as several series (generation +
							// consumption legs, or split periods), so accumulate per EIC.
							const byEic = new Map<string, UnitOutput>();
							for (const ts of series) {
								const eic = ts.resourceEic;
								const name = ts.resourceName;
								if (!eic || !name) continue;
								const fuel = ts.psrType
									? PSR_TO_PRODUCTION[ts.psrType]
									: undefined;
								if (!fuel) continue;
								const v = valueAt(ts, at);
								if (v === null) continue;

								// A pumping unit is published as a consumption series; carry
								// it as negative so a plant's net output stays honest.
								const mw = ts.isConsumption ? -v : v;
								const prev = byEic.get(eic);
								if (prev) prev.mw += mw;
								else byEic.set(eic, { eic, name, area: area.code, fuel, mw });
							}
							return [...byEic.values()];
						});
					},
					() => undefined,
				);

				if (units?.some((u) => u.length > 0)) {
					unitAreas.push(area.code);
					return units;
				}
				return times.map((): UnitOutput[] => []);
			}),
		);

		const [areaFrames, flowFrames, unitFrames] = await Promise.all([
			Promise.all(areaTasks),
			Promise.all(flowTasks),
			Promise.all(unitTasks),
		]);

		const fetchedAt = now.toISOString();
		return {
			stepMinutes: HISTORY_STEP_MINUTES,
			frames: times.map((at, i) => ({
				timestamp: at.toISOString(),
				fetchedAt,
				source: "entsoe",
				areas: areaFrames.map((a) => a[i]),
				flows: flowFrames
					.map((f) => f[i])
					.filter((f): f is BorderFlow => f !== null),
				degraded: [...degraded],
				units: unitFrames.flatMap((u) => u[i]),
				unitAreas,
			})),
		};
	}
}

/** Order a border so `netMw` is always >= 0, i.e. power moves from -> to. */
function netFlow(
	a: string,
	b: string,
	forward: number,
	reverse: number,
): BorderFlow {
	const net = forward - reverse;
	return net >= 0
		? { from: a, to: b, netMw: net, forwardMw: forward, reverseMw: reverse }
		: { from: b, to: a, netMw: -net, forwardMw: reverse, reverseMw: forward };
}
