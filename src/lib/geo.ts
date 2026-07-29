/** Tiny geodesy helpers, so the client bundle does not need all of turf. */

const EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Point reached by travelling `km` from `[lon, lat]` along `bearing` degrees. */
export function destination(
	[lon, lat]: [number, number],
	km: number,
	bearing: number,
): [number, number] {
	const d = km / EARTH_KM;
	const br = toRad(bearing);
	const lat1 = toRad(lat);
	const lon1 = toRad(lon);

	const lat2 = Math.asin(
		Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
	);
	const lon2 =
		lon1 +
		Math.atan2(
			Math.sin(br) * Math.sin(d) * Math.cos(lat1),
			Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
		);

	return [((toDeg(lon2) + 540) % 360) - 180, toDeg(lat2)];
}
