/**
 * Security headers and Content Security Policy (Round 3 Task 02, PRIV-4). Built from what the app actually
 * loads (audited for this task):
 *   - scripts: same-origin only (Next.js chunks, public/theme-init.js). Next.js App Router also emits inline
 *     <script> tags carrying the React Server Components payload, so script-src needs 'unsafe-inline'. A nonce
 *     would make every page dynamic, which Cache Components / partial prerendering rule out today. No eval in
 *     production; React's development build needs 'unsafe-eval'.
 *   - styles: same-origin plus inline style attributes (Tailwind, Radix, sonner).
 *   - fonts: self-hosted by next/font (no Google Fonts request at runtime).
 *   - images: same-origin, data: and blob: (no remote images are used).
 *   - network: same-origin (Server Functions, route handlers) and the Supabase project URL (signed uploads to
 *     Storage). Development adds websockets for hot reload.
 *   - no frames, plugins or <base> changes; forms post only to this origin; the app cannot be framed.
 * The policy blocks loading or exfiltrating to any other host, framing (clickjacking), plugin content and base
 * hijacking. It does not by itself stop an injected inline script (see 'unsafe-inline' above): the
 * httpOnly session cookies (lib/supabase/cookie-options.ts) are what keep the session out of reach.
 */

export interface CspOptions {
  /** NEXT_PUBLIC_SUPABASE_URL; only its origin is used. Invalid or absent → not allowed. */
  supabaseUrl?: string;
  /** Development build (hot reload, React dev tooling). */
  dev: boolean;
}

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(opts: CspOptions): string {
  const supabase = origin(opts.supabaseUrl);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(supabase ? [supabase] : []), ...(opts.dev ? ["ws:", "wss:"] : [])],
    "media-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!opts.dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Headers for every route (next.config.ts). Referrer-Policy is left to proxy.ts (token routes: no-referrer). */
export function securityHeaders(opts: CspOptions): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}
