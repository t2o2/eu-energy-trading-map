import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server otherwise blocks its own chunks when reached via 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
