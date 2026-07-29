/**
 * Node's ESM resolver requires file extensions; the app's TypeScript sources use
 * extensionless relative imports (bundler-style, as tsconfig specifies). This
 * hook re-resolves those to .ts so build scripts can import app code directly.
 *
 * Usage: node --experimental-transform-types --import ./scripts/ts-resolve.mjs ...
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

if (!process.env.__TS_RESOLVE_REGISTERED) {
	process.env.__TS_RESOLVE_REGISTERED = "1";
	register("./ts-resolve-hooks.mjs", pathToFileURL(`${import.meta.dirname}/`));
}
