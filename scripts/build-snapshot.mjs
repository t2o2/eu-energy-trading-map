/**
 * Writes public/data/snapshot.json, the single data file the static site reads:
 * 24 hourly frames the time slider scrubs through, newest last.
 *
 * GitHub Pages cannot run the old /api/snapshot route, so the fetch that used to
 * happen per request happens here instead — once per deploy, on the daily cron.
 *
 * The committed snapshot doubles as the last-known-good fallback. ENTSO-E takes
 * the Transparency Platform down for maintenance without warning, and a fetch
 * during that window returns nothing for every area; writing that over good data
 * publishes an empty map. So a candidate has to earn the write, and CI commits
 * the file back whenever a fetch is healthy, which rolls the fallback forward.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EntsoeSource } from "../src/lib/sources/entsoe/index.ts";
import { MockSource } from "../src/lib/sources/mock.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "data", "snapshot.json");

/** Above this share of areas reporting nothing, the fetch is an outage. */
const MAX_DEGRADED = 0.25;

/** GitHub renders these as annotations; harmless noise in a local run. */
function warn(message) {
	console.log(`::warning::[snapshot] ${message}`);
}

function describe(history) {
	const latest = history.frames[history.frames.length - 1];
	return (
		`${history.frames.length} frames @ ${history.stepMinutes}min, ` +
		`${latest.areas.length} areas, ${latest.flows.length} flows, ` +
		`${latest.degraded.length} degraded, latest ${latest.timestamp}`
	);
}

/** Structurally sound enough to publish? */
function usable(history) {
	return (
		history &&
		Array.isArray(history.frames) &&
		history.frames.length > 0 &&
		history.frames.every((f) => Array.isArray(f.areas) && Array.isArray(f.flows))
	);
}

/** The existing file, or null when absent or unreadable. */
function existing() {
	if (!existsSync(out)) return null;
	try {
		const parsed = JSON.parse(readFileSync(out, "utf8"));
		return usable(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

const token = process.env.ENTSOE_TOKEN?.trim();
const source =
	token && process.env.DATA_SOURCE !== "mock"
		? new EntsoeSource(token)
		: new MockSource();

console.log(`[snapshot] source=${source.name}`);

let candidate = null;
try {
	candidate = await source.fetchHistory();
} catch (err) {
	warn(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
}

/** Why this candidate cannot be published, or null when it can. */
function rejection(history) {
	if (!history) return "no data returned";
	if (!usable(history)) return "malformed history";

	const latest = history.frames[history.frames.length - 1];
	const areas = latest.areas.length;
	if (areas === 0) return "no areas";

	const share = latest.degraded.length / areas;
	if (share > MAX_DEGRADED) {
		return (
			`${latest.degraded.length} of ${areas} areas degraded ` +
			`(${Math.round(share * 100)}%, limit ${Math.round(MAX_DEGRADED * 100)}%)`
		);
	}
	return null;
}

const reason = candidate ? rejection(candidate) : "no data returned";

if (!reason) {
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(candidate));
	console.log(`[snapshot] wrote ${describe(candidate)}`);
} else {
	const fallback = existing();
	if (!fallback) {
		console.error(
			`[snapshot] rejected candidate (${reason}) and no usable snapshot to fall back on`,
		);
		process.exit(1);
	}
	warn(
		`kept the existing snapshot: candidate rejected (${reason}). ` +
			`Serving ${describe(fallback)}`,
	);
}
