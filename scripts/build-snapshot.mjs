/**
 * Writes public/data/snapshot.json, the single data file the static site reads.
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

const snapshot = await source.fetchSnapshot();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot));

console.log(
	`[snapshot] ${snapshot.areas.length} areas, ${snapshot.flows.length} flows, ` +
		`${snapshot.degraded.length} degraded, at ${snapshot.timestamp}`,
);
