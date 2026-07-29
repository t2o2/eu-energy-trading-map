import type { GridSnapshot } from "./domain/types";
import { EntsoeSource } from "./sources/entsoe";
import { MockSource } from "./sources/mock";
import type { GridSource } from "./sources/source";

/** ENTSO-E publishes on a 15-minute cadence, so caching longer buys nothing. */
const TTL_MS = 15 * 60_000;

/** Serve stale data rather than an error if the upstream goes down. */
const STALE_MS = 2 * 60 * 60_000;

function selectSource(): GridSource {
	const token = process.env.ENTSOE_TOKEN?.trim();
	if (token && process.env.DATA_SOURCE !== "mock")
		return new EntsoeSource(token);
	return new MockSource();
}

interface CacheEntry {
	snapshot: GridSnapshot;
	expiresAt: number;
}

// Module-level so it survives across requests within a single server process.
let cache: CacheEntry | null = null;
let inFlight: Promise<GridSnapshot> | null = null;

export async function getSnapshot(): Promise<GridSnapshot> {
	const now = Date.now();
	if (cache && now < cache.expiresAt) return cache.snapshot;

	// Collapse concurrent misses into one upstream fetch.
	if (inFlight) return inFlight;

	const source = selectSource();
	inFlight = source
		.fetchSnapshot()
		.then((snapshot) => {
			cache = { snapshot, expiresAt: Date.now() + TTL_MS };
			return snapshot;
		})
		.catch((err) => {
			if (
				cache &&
				Date.now() - Date.parse(cache.snapshot.fetchedAt) < STALE_MS
			) {
				return cache.snapshot;
			}
			throw err;
		})
		.finally(() => {
			inFlight = null;
		});

	return inFlight;
}
