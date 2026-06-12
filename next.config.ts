import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  webpack(config, { isServer }) {
    if (isServer) {
      // paper is browser-only; replace with empty module during SSR to avoid
      // its Node.js canvas.js → jsdom dependency being bundled server-side.
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias as object || {}),
        'paper': false,
        'paper/dist/paper-core': false,
      };
    }
    return config;
  },
};

export default nextConfig;
