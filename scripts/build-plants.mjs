/**
 * Precomputes public/geo/plants.json — power stations of 100 MW and above
 * across the ENTSO-E areas, from the WRI Global Power Plant Database v1.3.
 *
 * The WRI database is the only openly licensed source that gives coordinates,
 * capacity and fuel for every European plant in one place (CC-BY 4.0). It is a
 * 2021 snapshot, so plants commissioned or retired since then are missing;
 * that staleness is surfaced in the UI rather than hidden.
 *
 * ENTSO-E is the source for live output, but it publishes unit EIC codes and
 * names with no coordinates, so the two are joined on normalised names at
 * runtime (see src/lib/plants.ts).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { AREAS } from "../src/lib/domain/areas.ts";

const SOURCE_URL =
	"https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.zip";
const CACHE = "node_modules/.cache/gppd.zip";

/** Smallest plant to keep, in MW. Below this the map becomes unreadable. */
const MIN_CAPACITY_MW = 100;

/** ISO 3166-1 alpha-3 (WRI) -> alpha-2 (our areas). */
const ISO3_TO_ISO2 = {
	ALB: "AL",
	AUT: "AT",
	BIH: "BA",
	BEL: "BE",
	BGR: "BG",
	CHE: "CH",
	CZE: "CZ",
	DEU: "DE",
	DNK: "DK",
	EST: "EE",
	ESP: "ES",
	FIN: "FI",
	FRA: "FR",
	GBR: "GB",
	GRC: "GR",
	HRV: "HR",
	HUN: "HU",
	IRL: "IE",
	ITA: "IT",
	LTU: "LT",
	LUX: "LU",
	LVA: "LV",
	MDA: "MD",
	MNE: "ME",
	MKD: "MK",
	NLD: "NL",
	NOR: "NO",
	POL: "PL",
	PRT: "PT",
	ROU: "RO",
	SRB: "RS",
	SWE: "SE",
	SVN: "SI",
	SVK: "SK",
	UKR: "UA",
	TUR: "TR",
	XKX: "XK",
};

/**
 * WRI primary_fuel -> our ProductionType. WRI does not separate lignite from
 * hard coal, so every solid-fuel plant lands on `coal`; pumped storage is
 * usually filed as Hydro and is only recovered when the name says so.
 */
const FUEL_TO_PRODUCTION = {
	Solar: "solar",
	Wind: "wind",
	Hydro: "hydro",
	Gas: "gas",
	Biomass: "biomass",
	Waste: "waste",
	Coal: "coal",
	Oil: "oil",
	Nuclear: "nuclear",
	Geothermal: "geothermal",
	Storage: "pumpedStorage",
	Petcoke: "coal",
	Cogeneration: "gas",
	"Wave and Tidal": "other",
	Other: "other",
};

// --- zip reading -----------------------------------------------------------

/**
 * Minimal single-entry zip extractor. The archive holds one CSV plus PDFs, and
 * pulling in a zip dependency for that is not worth it. Walks local file
 * headers (PK\x03\x04) rather than the central directory, which is enough for
 * a stored/deflated archive with no encryption.
 */
function extractFromZip(buf, wantSuffix) {
	let off = 0;
	while (off + 30 <= buf.length) {
		if (buf.readUInt32LE(off) !== 0x04034b50) break;
		const method = buf.readUInt16LE(off + 8);
		const flags = buf.readUInt16LE(off + 6);
		let compSize = buf.readUInt32LE(off + 18);
		let uncompSize = buf.readUInt32LE(off + 22);
		const nameLen = buf.readUInt16LE(off + 26);
		const extraLen = buf.readUInt16LE(off + 28);
		const name = buf.toString("utf8", off + 30, off + 30 + nameLen);
		const dataStart = off + 30 + nameLen + extraLen;

		// Zip64: sizes of 0xffffffff are carried in the extra field.
		if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
			let e = off + 30 + nameLen;
			const end = e + extraLen;
			while (e + 4 <= end) {
				const hid = buf.readUInt16LE(e);
				const hsz = buf.readUInt16LE(e + 2);
				if (hid === 0x0001) {
					uncompSize = Number(buf.readBigUInt64LE(e + 4));
					compSize = Number(buf.readBigUInt64LE(e + 12));
					break;
				}
				e += 4 + hsz;
			}
		}

		if ((flags & 0x08) !== 0 && compSize === 0) {
			throw new Error(`streamed entry without sizes: ${name}`);
		}

		if (name.endsWith(wantSuffix)) {
			const raw = buf.subarray(dataStart, dataStart + compSize);
			return method === 0 ? raw : inflateRawSync(raw);
		}
		off = dataStart + compSize;
	}
	throw new Error(`no entry ending in ${wantSuffix}`);
}

// --- csv -------------------------------------------------------------------

/** RFC 4180 parser: the WRI file has quoted fields containing commas. */
function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
			continue;
		}
		if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else if (c !== "\r") field += c;
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const header = rows.shift();
	return rows
		.filter((r) => r.length === header.length)
		.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// --- main ------------------------------------------------------------------

async function load() {
	if (existsSync(CACHE)) {
		console.log(`using cached ${CACHE}`);
		return readFileSync(CACHE);
	}
	console.log(`downloading ${SOURCE_URL}`);
	const res = await fetch(SOURCE_URL);
	if (!res.ok) throw new Error(`download failed: ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	mkdirSync("node_modules/.cache", { recursive: true });
	writeFileSync(CACHE, buf);
	return buf;
}

const zip = await load();
const csv = extractFromZip(zip, "global_power_plant_database.csv").toString(
	"utf8",
);
const rows = parseCsv(csv);
console.log(`parsed ${rows.length} plants worldwide`);

const areaByIso2 = new Map(AREAS.map((a) => [a.iso2, a]));
const features = [];
const skipped = { fuel: 0, small: 0, coords: 0 };

for (const r of rows) {
	const iso2 = ISO3_TO_ISO2[r.country];
	if (!iso2) continue;
	const area = areaByIso2.get(iso2);
	if (!area) continue;

	const capacity = Number(r.capacity_mw);
	if (!Number.isFinite(capacity) || capacity < MIN_CAPACITY_MW) {
		skipped.small++;
		continue;
	}

	const lat = Number(r.latitude);
	const lon = Number(r.longitude);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
		skipped.coords++;
		continue;
	}

	const fuel = FUEL_TO_PRODUCTION[r.primary_fuel];
	if (!fuel) {
		skipped.fuel++;
		continue;
	}

	// WRI files pumped storage under Hydro; the name is the only hint we get.
	const isPumped = /pump|pomp|pump-?ed|psp\b/i.test(r.name) && fuel === "hydro";
	const year = Number(r.commissioning_year);

	features.push({
		type: "Feature",
		id: r.gppd_idnr,
		geometry: { type: "Point", coordinates: [round(lon), round(lat)] },
		properties: {
			id: r.gppd_idnr,
			name: r.name,
			area: area.code,
			iso2,
			fuel: isPumped ? "pumpedStorage" : fuel,
			capacityMw: Math.round(capacity * 10) / 10,
			...(Number.isFinite(year) && year > 1800
				? { year: Math.round(year) }
				: {}),
			...(r.owner ? { owner: r.owner } : {}),
		},
	});
}

function round(n) {
	return Math.round(n * 10000) / 10000;
}

features.sort((a, b) => b.properties.capacityMw - a.properties.capacityMw);

const byFuel = {};
for (const f of features) {
	byFuel[f.properties.fuel] = (byFuel[f.properties.fuel] ?? 0) + 1;
}

mkdirSync("public/geo", { recursive: true });
writeFileSync(
	"public/geo/plants.json",
	JSON.stringify({
		type: "FeatureCollection",
		metadata: {
			source: "WRI Global Power Plant Database v1.3",
			license: "CC-BY 4.0",
			vintage: "2021",
			minCapacityMw: MIN_CAPACITY_MW,
			count: features.length,
		},
		features,
	}),
);

console.log(
	`wrote public/geo/plants.json — ${features.length} plants >= ${MIN_CAPACITY_MW} MW`,
);
console.log("by fuel:", byFuel);
console.log(
	`skipped: ${skipped.small} under threshold, ${skipped.fuel} unmapped fuel`,
);
