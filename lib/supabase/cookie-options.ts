/**
 * Session cookie options (Round 3 Task 02, PRIV-4). Passed to EVERY server Supabase client (server.ts and
 * proxy.ts), and merged by @supabase/ssr into every auth cookie it writes or clears, including the PKCE code
 * verifier: all of them are read only on the server (sign-in starts in a Server Function, /auth/callback
 * exchanges the code, proxy.ts refreshes the session).
 *
 * - httpOnly: JavaScript in the page can no longer read the session (the library default is false). The
 *   browser has no Supabase session client any more: uploads use the signed upload token (client.ts).
 * - secure: in production builds only (http://localhost development keeps working; browsers also treat
 *   localhost as secure).
 * - sameSite "lax" and path "/" are the library defaults, restated so a library change cannot loosen them.
 * maxAge stays the library's (400 days, renewed by proxy.ts); the session itself expires per Supabase Auth.
 */

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
}

export function sessionCookieOptions(env: Record<string, string | undefined> = process.env): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/" };
}
