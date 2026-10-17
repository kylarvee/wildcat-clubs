import type { NextConfig } from "next";

// Every page here depends on who is signed in, so pages render per request.
// Cache Components stays off until the platform needs it (see ARCHITECTURE.md).
const nextConfig: NextConfig = {
  // A separate build dir lets a production build/smoke test run beside `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: false,
  serverExternalPackages: ["@react-pdf/renderer", "sanitize-html"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
