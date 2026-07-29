/**
 * GitHub Pages project sites live under /<repo>, and `fetch()` calls to files in
 * public/ are not rewritten by Next's basePath — only <Link>/<Image> are. So any
 * runtime asset URL has to be prefixed by hand.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function asset(path: string): string {
	return `${BASE_PATH}${path}`;
}
