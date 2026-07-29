import type { AreaCode, ProductionType, UnitOutput } from "./domain/types";

/**
 * A power station from the precomputed WRI extract (public/geo/plants.json).
 * Static: coordinates, capacity and fuel, with no live data of its own.
 */
export interface PlantProps {
	id: string;
	name: string;
	area: AreaCode;
	iso2: string;
	fuel: ProductionType;
	capacityMw: number;
	year?: number;
	owner?: string;
}

export interface PlantsMetadata {
	source: string;
	license: string;
	vintage: string;
	minCapacityMw: number;
	count: number;
}

/**
 * A plant joined to whatever live data we could match to it.
 *
 * ENTSO-E publishes unit EIC codes and names but no coordinates; WRI publishes
 * coordinates but no EIC codes. There is no shared key, so the join is on
 * normalised names and is necessarily approximate — `matched` records whether
 * it succeeded so the UI can say so rather than implying the number is
 * authoritative.
 */
export interface PlantLive {
	/** Summed output in MW of every unit matched to this plant. */
	mw: number;
	/** Number of generating units matched. */
	units: number;
	/** How the match was made, surfaced in the popup. */
	matched: "name";
}

/**
 * Normalise a station name for comparison across the two datasets.
 *
 * ENTSO-E unit names carry a unit number ("CATTENOM 3", "DOEL 4") while WRI
 * names the whole station ("Cattenom"), so the trailing unit designator is
 * stripped and units are aggregated back up to the station.
 */
function normalisePlantName(raw: string): string {
	let s = raw
		.toLowerCase()
		.normalize("NFD")
		// Strip diacritics so "Sankt Florian" matches "Sänkt Florian".
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[_/]/g, " ")
		.replace(/[^a-z0-9 -]/g, " ");

	// Drop corporate and plant-type noise that only one of the two sources uses.
	s = s.replace(
		/\b(power|plant|station|centrale|kraftwerk|kernkraftwerk|elektrownia|centrala|cpp|chp|ccgt|ocgt|thermal|nuclear|hydro|wind ?farm|solar|gmbh|ag|sa|spa|as|ab|oy|nv|bv|ltd|plc|energy|energie|energia|power ?station)\b/g,
		" ",
	);

	// Trailing unit designators: "3", "II", "unit 3", "tg2", "b1".
	s = s.replace(
		/\b(unit|tranche|bloc|block|blok|groupe|gruppo|grupo|tg|gt|st)\s*[0-9ivx]+\b/g,
		" ",
	);
	s = s.replace(/\s+[0-9]{1,2}$/, " ");
	s = s.replace(/\s+[ivx]{1,4}$/, " ");

	return s.replace(/\s+/g, " ").trim();
}

/**
 * Join live per-unit output onto static plants, keyed by normalised name
 * within an area.
 *
 * Matching is deliberately strict — exact normalised equality within the same
 * area — because a loose match would attach one station's output to another's
 * coordinates, which is worse than showing nothing. Unmatched units are
 * counted so the UI can report how much live data went unplaced.
 */
export function joinLiveOutput(
	plants: PlantProps[],
	units: UnitOutput[],
): {
	live: Map<string, PlantLive>;
	unmatchedUnits: number;
	unmatchedMw: number;
} {
	const plantsByKey = new Map<string, PlantProps[]>();
	for (const p of plants) {
		const key = `${p.area}|${normalisePlantName(p.name)}`;
		const list = plantsByKey.get(key);
		if (list) list.push(p);
		else plantsByKey.set(key, [p]);
	}

	const live = new Map<string, PlantLive>();
	let unmatchedUnits = 0;
	let unmatchedMw = 0;

	for (const u of units) {
		const key = `${u.area}|${normalisePlantName(u.name)}`;
		const candidates = plantsByKey.get(key);
		if (!candidates || candidates.length === 0) {
			unmatchedUnits++;
			unmatchedMw += Math.max(0, u.mw);
			continue;
		}

		// An ambiguous name within one area cannot be resolved without a shared
		// key, so prefer the plant whose fuel agrees, then the largest.
		const target =
			candidates.find((c) => c.fuel === u.fuel) ??
			candidates.reduce((a, b) => (b.capacityMw > a.capacityMw ? b : a));

		const prev = live.get(target.id);
		if (prev) {
			prev.mw += u.mw;
			prev.units += 1;
		} else {
			live.set(target.id, { mw: u.mw, units: 1, matched: "name" });
		}
	}

	return { live, unmatchedUnits, unmatchedMw };
}

/** Marker radius in px, scaled by capacity so big stations read as big. */
export function plantRadius(capacityMw: number): number {
	return 2.6 + Math.min(11, Math.sqrt(capacityMw) / 7.5);
}
