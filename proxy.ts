/**
 * Next.js 16 Proxy (formerly middleware). Refreshes the Supabase session cookies on every page request
 * and redirects signed-out visitors away from workspace routes. This is an optimistic check: pages,
 * Server Functions and the database (RLS + checked SQL functions) all verify access themselves (§8.3).
 *
 * Token routes (/g/[token], /h/[token]) never require a session (D8, §12.3) and get no-referrer.
 *
 * R3 Task 06 (D4): the public demo (/demo, /demo/...) runs entirely in the visitor's browser on synthetic data and never
 * uses a session, so its requests skip the session refresh: they never reach the Auth server or touch auth cookies.
 *
 * /auth/callback is deliberately NOT refreshed here. It exchanges a sign-in code using the PKCE verifier stored
 * in this browser, and replaces any old session itself. Refreshing first is harmful: with a stale session
 * cookie the refresh fails, and auth-js's session teardown then deletes every pending PKCE verifier before the
 * callback runs, so every Google sign-in from that browser failed ("pkce_code_verifier_not_found").
 */

import { NextResponse, type NextRequest } from "next/server";

import { isOwner } from "@/lib/selftest/gate";
import { updateSession } from "@/lib/supabase/proxy";
import { loginPath } from "@/lib/supabase/redirects";

// /test is the owner-only self-check (docs/operations/owner-self-check.md): signed-out visitors go to login like
// every protected route; signed-in users who are not on BATON_OWNER_EMAILS get a real 404 (the page checks again).
const OWNER_ONLY_PREFIX = "/test";
const PROTECTED_PREFIXES = ["/dashboard", "/handover", "/account", "/connect", OWNER_ONLY_PREFIX];
const TOKEN_PREFIXES = ["/g/", "/h/"];
const AUTH_CALLBACK = "/auth/callback";
const DEMO_PREFIX = "/demo";
const CONNECTOR_MACHINE_PATH = /^\/api\/connectors\/(?:sync|(?:github|discord|slack|telegram)\/webhook)$/;

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === AUTH_CALLBACK) return NextResponse.next();
  if (pathname === DEMO_PREFIX || pathname.startsWith(`${DEMO_PREFIX}/`)) return NextResponse.next();
  // Round 4: provider webhooks and the connector sync are server-to-server (signed by the provider / CRON_SECRET);
  // they never use a browser session, so skip the Auth round trip (Slack expects an answer within 3 s).
  if (CONNECTOR_MACHINE_PATH.test(pathname)) return NextResponse.next();
  const { response, userId, user } = await updateSession(request);

  if (startsWithAny(pathname, TOKEN_PREFIXES)) {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  if (!userId && startsWithAny(pathname, PROTECTED_PREFIXES)) {
    const redirect = NextResponse.redirect(new URL(loginPath(pathname + search), request.url));
    // keep any refreshed/cleared auth cookies
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  if (userId && startsWithAny(pathname, [OWNER_ONLY_PREFIX]) && !isOwner(user)) {
    // Rewrite to a path that matches no route: the app's not-found page renders with status 404.
    const notFound = NextResponse.rewrite(new URL("/_not-found-owner-only", request.url), { status: 404 });
    for (const cookie of response.cookies.getAll()) notFound.cookies.set(cookie);
    return notFound;
  }

  if (userId && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation. `js` covers public/theme-init.js, which blocks
    // first paint and so must never wait on a session refresh (no app route ends in .js).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|js)$).*)",
  ],
};
