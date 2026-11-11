/**
 * Session refresh for proxy.ts (Next.js 16: middleware → proxy). Runs before every matched request:
 * refreshes the auth cookies and reports the user. This is an optimistic check only; every page, Server
 * Function and SQL function still verifies the user itself (§8.3; Next.js "Data Security" guide).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv, isSupabaseConfigured } from "./env";

export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return { response, userId: null };

  const { url, anonKey } = getSupabasePublicEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() asks the Auth server to validate the JWT (getSession() would trust the cookie). Do not run
  // other code between creating the client and this call: it is what refreshes an expired session.
  const { data } = await supabase.auth.getUser();
  return { response, userId: data.user?.id ?? null };
}
