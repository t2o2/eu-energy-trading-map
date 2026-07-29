/** Resolve hook: retry extensionless relative specifiers as .ts, then /index.ts. */
export async function resolve(specifier, context, nextResolve) {
	try {
		return await nextResolve(specifier, context);
	} catch (err) {
		if (!specifier.startsWith(".")) throw err;
		for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
			try {
				return await nextResolve(candidate, context);
			} catch {
				// Try the next candidate; rethrow the original error if none work.
			}
		}
		throw err;
	}
}
