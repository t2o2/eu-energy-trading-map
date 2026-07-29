import type { AreaCode } from "./types";

export interface Area {
	/** ENTSO-E EIC area code. The primary key throughout the app. */
	code: AreaCode;
	/** ISO 3166-1 alpha-2, used to join against Natural Earth polygons. */
	iso2: string;
	name: string;
	/** IANA timezone, used to label the local hour in the detail panel. */
	tz: string;
}

/**
 * ENTSO-E country-level areas. Countries with multiple bidding zones (NO, SE,
 * DK, IT) are represented by their country-level EIC code; ENTSO-E aggregates
 * the zones for us on these endpoints.
 */
export const AREAS: Area[] = [
	{
		code: "10YAL-KESH-----5",
		iso2: "AL",
		name: "Albania",
		tz: "Europe/Tirane",
	},
	{
		code: "10YAT-APG------L",
		iso2: "AT",
		name: "Austria",
		tz: "Europe/Vienna",
	},
	{
		code: "10YBA-JPCC-----D",
		iso2: "BA",
		name: "Bosnia and Herzegovina",
		tz: "Europe/Sarajevo",
	},
	{
		code: "10YBE----------2",
		iso2: "BE",
		name: "Belgium",
		tz: "Europe/Brussels",
	},
	{
		code: "10YCA-BULGARIA-R",
		iso2: "BG",
		name: "Bulgaria",
		tz: "Europe/Sofia",
	},
	{
		code: "10YCH-SWISSGRIDZ",
		iso2: "CH",
		name: "Switzerland",
		tz: "Europe/Zurich",
	},
	{
		code: "10YCZ-CEPS-----N",
		iso2: "CZ",
		name: "Czechia",
		tz: "Europe/Prague",
	},
	{
		code: "10Y1001A1001A83F",
		iso2: "DE",
		name: "Germany",
		tz: "Europe/Berlin",
	},
	{
		code: "10Y1001A1001A65H",
		iso2: "DK",
		name: "Denmark",
		tz: "Europe/Copenhagen",
	},
	{
		code: "10Y1001A1001A39I",
		iso2: "EE",
		name: "Estonia",
		tz: "Europe/Tallinn",
	},
	{ code: "10YES-REE------0", iso2: "ES", name: "Spain", tz: "Europe/Madrid" },
	{
		code: "10YFI-1--------U",
		iso2: "FI",
		name: "Finland",
		tz: "Europe/Helsinki",
	},
	{ code: "10YFR-RTE------C", iso2: "FR", name: "France", tz: "Europe/Paris" },
	{
		code: "10YGB----------A",
		iso2: "GB",
		name: "United Kingdom",
		tz: "Europe/London",
	},
	{ code: "10YGR-HTSO-----Y", iso2: "GR", name: "Greece", tz: "Europe/Athens" },
	{
		code: "10YHR-HEP------M",
		iso2: "HR",
		name: "Croatia",
		tz: "Europe/Zagreb",
	},
	{
		code: "10YHU-MAVIR----U",
		iso2: "HU",
		name: "Hungary",
		tz: "Europe/Budapest",
	},
	{
		code: "10Y1001A1001A59C",
		iso2: "IE",
		name: "Ireland",
		tz: "Europe/Dublin",
	},
	{ code: "10YIT-GRTN-----B", iso2: "IT", name: "Italy", tz: "Europe/Rome" },
	{
		code: "10YLT-1001A0008Q",
		iso2: "LT",
		name: "Lithuania",
		tz: "Europe/Vilnius",
	},
	{
		code: "10YLU-CEGEDEL-NQ",
		iso2: "LU",
		name: "Luxembourg",
		tz: "Europe/Luxembourg",
	},
	{ code: "10YLV-1001A00074", iso2: "LV", name: "Latvia", tz: "Europe/Riga" },
	{
		code: "10Y1001A1001A990",
		iso2: "MD",
		name: "Moldova",
		tz: "Europe/Chisinau",
	},
	{
		code: "10YCS-CG-TSO---S",
		iso2: "ME",
		name: "Montenegro",
		tz: "Europe/Podgorica",
	},
	{
		code: "10YMK-MEPSO----8",
		iso2: "MK",
		name: "North Macedonia",
		tz: "Europe/Skopje",
	},
	{
		code: "10YNL----------L",
		iso2: "NL",
		name: "Netherlands",
		tz: "Europe/Amsterdam",
	},
	{ code: "10YNO-0--------C", iso2: "NO", name: "Norway", tz: "Europe/Oslo" },
	{ code: "10YPL-AREA-----S", iso2: "PL", name: "Poland", tz: "Europe/Warsaw" },
	{
		code: "10YPT-REN------W",
		iso2: "PT",
		name: "Portugal",
		tz: "Europe/Lisbon",
	},
	{
		code: "10YRO-TEL------P",
		iso2: "RO",
		name: "Romania",
		tz: "Europe/Bucharest",
	},
	{
		code: "10YCS-SERBIATSOV",
		iso2: "RS",
		name: "Serbia",
		tz: "Europe/Belgrade",
	},
	{
		code: "10YSE-1--------K",
		iso2: "SE",
		name: "Sweden",
		tz: "Europe/Stockholm",
	},
	{
		code: "10YSI-ELES-----O",
		iso2: "SI",
		name: "Slovenia",
		tz: "Europe/Ljubljana",
	},
	{
		code: "10YSK-SEPS-----K",
		iso2: "SK",
		name: "Slovakia",
		tz: "Europe/Bratislava",
	},
	{ code: "10Y1001C--00003F", iso2: "UA", name: "Ukraine", tz: "Europe/Kyiv" },
	{
		code: "10YTR-TEIAS----W",
		iso2: "TR",
		name: "Türkiye",
		tz: "Europe/Istanbul",
	},
	{
		code: "10Y1001C--00100H",
		iso2: "XK",
		name: "Kosovo",
		tz: "Europe/Belgrade",
	},
];

export const AREA_BY_CODE = new Map(AREAS.map((a) => [a.code, a]));
const AREA_BY_ISO2 = new Map(AREAS.map((a) => [a.iso2, a]));

export function areaName(code: AreaCode): string {
	return AREA_BY_CODE.get(code)?.name ?? code;
}

/**
 * Interconnected area pairs, written as ISO2 for legibility. This is the
 * authoritative set of borders we query ENTSO-E for; it includes subsea cables
 * between non-adjacent countries (NO-NL NorNed, LT-SE NordBalt, GB-DK Viking).
 * Each pair is queried in both directions and netted.
 */
const BORDER_PAIRS_ISO2: [string, string][] = [
	["AL", "GR"],
	["AL", "ME"],
	["AL", "MK"],
	["AL", "XK"],
	["AT", "CH"],
	["AT", "CZ"],
	["AT", "DE"],
	["AT", "HU"],
	["AT", "IT"],
	["AT", "SI"],
	["BA", "HR"],
	["BA", "ME"],
	["BA", "RS"],
	["BE", "DE"],
	["BE", "FR"],
	["BE", "GB"],
	["BE", "LU"],
	["BE", "NL"],
	["BG", "GR"],
	["BG", "MK"],
	["BG", "RO"],
	["BG", "RS"],
	["BG", "TR"],
	["CH", "DE"],
	["CH", "FR"],
	["CH", "IT"],
	["CZ", "DE"],
	["CZ", "PL"],
	["CZ", "SK"],
	["DE", "DK"],
	["DE", "FR"],
	["DE", "LU"],
	["DE", "NL"],
	["DE", "NO"],
	["DE", "PL"],
	["DE", "SE"],
	["DK", "GB"],
	["DK", "NL"],
	["DK", "NO"],
	["DK", "SE"],
	["EE", "FI"],
	["EE", "LV"],
	["ES", "FR"],
	["ES", "PT"],
	["FI", "NO"],
	["FI", "SE"],
	["FR", "GB"],
	["FR", "IT"],
	["GB", "IE"],
	["GB", "NL"],
	["GB", "NO"],
	["GR", "IT"],
	["GR", "MK"],
	["GR", "TR"],
	["HR", "HU"],
	["HR", "RS"],
	["HR", "SI"],
	["HU", "RO"],
	["HU", "RS"],
	["HU", "SK"],
	["HU", "UA"],
	["IT", "ME"],
	["IT", "SI"],
	["LT", "LV"],
	["LT", "PL"],
	["LT", "SE"],
	["MD", "RO"],
	["MD", "UA"],
	["ME", "RS"],
	["ME", "XK"],
	["MK", "RS"],
	["MK", "XK"],
	["NO", "SE"],
	["PL", "SE"],
	["PL", "SK"],
	["PL", "UA"],
	["RO", "RS"],
	["RO", "UA"],
	["RS", "XK"],
	["SK", "UA"],
];

export interface Border {
	a: AreaCode;
	b: AreaCode;
	isoA: string;
	isoB: string;
}

export const BORDERS: Border[] = BORDER_PAIRS_ISO2.flatMap(([x, y]) => {
	const a = AREA_BY_ISO2.get(x);
	const b = AREA_BY_ISO2.get(y);
	if (!a || !b) return [];
	return [{ a: a.code, b: b.code, isoA: a.iso2, isoB: b.iso2 }];
});
