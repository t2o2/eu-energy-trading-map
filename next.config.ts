import type { NextConfig } from "next";

// GitHub Pages serves project sites from /<repo>, so every asset and data URL
// needs that prefix. Empty locally and on a user/org page.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
	// Static export: there is no Node server on GitHub Pages.
	output: "export",
	basePath,
	images: { unoptimized: true },
	// The dev server otherwise blocks its own chunks when reached via 127.0.0.1.
	allowedDevOrigins: ["127.0.0.1"],
	turbopack: {
		root: __dirname,
	},
};

export default nextConfig;
