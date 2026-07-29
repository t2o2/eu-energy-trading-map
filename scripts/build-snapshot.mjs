/**
 * Writes public/data/snapshot.json, the single data file the static site reads:
 * 24 hourly frames the time slider scrubs through, newest last.
 *
 * GitHub Pages cannot run the old /api/snapshot route, so the fetch that used to
 * happen per request happens here instead — once per deploy, on the hourly cron.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EntsoeSource } from "../src/lib/sources/entsoe/index.ts";
import { MockSource } from "../src/lib/sources/mock.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "data", "snapshot.json");

const token = process.env.ENTSOE_TOKEN?.trim();
const source =
	token && process.env.DATA_SOURCE !== "mock"
		? new EntsoeSource(token)
		: new MockSource();

console.log(`[snapshot] source=${source.name}`);

const history = await source.fetchHistory();
const latest = history.frames[history.frames.length - 1];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(history));

console.log(
	`[snapshot] ${history.frames.length} frames @ ${history.stepMinutes}min, ` +
		`${latest.areas.length} areas, ${latest.flows.length} flows, ` +
		`${latest.degraded.length} degraded, latest ${latest.timestamp}`,
);
