import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // FIXME: ignoreBuildErrors masks ~58 `any` casts surfaced by strict type
  // checks. Drop this once the offenders are typed properly.
  typescript: { ignoreBuildErrors: true },
  allowedDevOrigins: ['10.80.13.15'],
};

export default nextConfig;
