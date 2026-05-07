import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Turbopack natively supports new Worker(new URL(...), { type: 'module' })
  turbopack: {},
};

export default nextConfig;
