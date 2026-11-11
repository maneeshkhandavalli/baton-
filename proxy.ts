/**
 * Next.js 16 Proxy (formerly middleware). Refreshes the Supabase session cookies on every page request
 * and redirects signed-out visitors away from workspace routes. This is an optimistic check: pages,
 * Server Functions and the database (RLS + checked SQL functions) all verify access themselves (§8.3).
 *
 * Token routes (/g/[token], /h/[token]) never require a session (D8, §12.3) and get no-referrer.
 */

import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";
import { loginPath } from "@/lib/supabase/redirects";

const PROTECTED_PREFIXES = ["/dashboard", "/handover", "/account"];
const TOKEN_PREFIXES = ["/g/", "/h/"];

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { response, userId } = await updateSession(request);

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

  if (userId && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
