import type { NextConfig } from "next";

import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // R3 Task 06 (security): Next logs every Server Function call WITH ITS ARGUMENTS during development by default.
  // Those arguments include passwords (signInWithPassword) and invitation tokens (acceptInvitation), which must
  // never reach a log. Keep it off.
  logging: { serverFunctions: false },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // R3 Task 02 (PRIV-4): Content Security Policy and related headers on every route (lib/security/headers.ts).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          dev: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
};

export default nextConfig;
