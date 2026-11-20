import type { NextConfig } from "next";

import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Development only: hosts allowed to load dev assets / HMR through a tunnel (Next blocks other origins). Set by
  // scripts/connectors/preview-3110.mjs from BATON_SITE_URL when it is not localhost; empty otherwise.
  allowedDevOrigins: (process.env.BATON_DEV_ORIGINS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
  // R3 Task 06 (security): Next logs every Server Function call WITH ITS ARGUMENTS during development by default.
  // Those arguments include passwords (signInWithPassword) and invitation tokens (acceptInvitation), which must
  // never reach a log. Keep it off.
  // R4 (21 Nov): the dev request log printed OAuth callback URLs in full, including the one-time authorization
  // `code` (seen for /api/email/google/callback). Never log the OAuth callbacks (Gmail and the connectors).
  logging: {
    serverFunctions: false,
    incomingRequests: { ignore: [/\/api\/(?:email\/google|connectors\/[a-z]+)\/callback(?:[/?]|$)/] },
  },
  // Development only: Next's floating dev badge sat on top of the sidebar's Help and Sign out controls.
  devIndicators: false,
  partialPrefetching: true,
  turbopack: {
    // Local worktrees whose node_modules is a junction to a sibling checkout set this to a common parent folder so
    // Turbopack can resolve packages outside the project directory. Unset everywhere else (including production).
    ...(process.env.BATON_TURBOPACK_ROOT ? { root: process.env.BATON_TURBOPACK_ROOT } : {}),
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
      // Performance audit 21 Nov: these two small render-blocking scripts were served with max-age=0, so every page
      // view revalidated them before first paint. An hour of caching (plus a day of stale-while-revalidate) is safe:
      // they change only with a deploy, and a stale copy for an hour only affects the theme/splash pre-paint logic.
      ...["/theme-init.js", "/intro-splash-init.js"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      })),
    ];
  },
};

export default nextConfig;
