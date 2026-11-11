import "server-only";

/**
 * Server Supabase client bound to the request's cookies (§12.3). Use in Server Components, Server
 * Functions and Route Handlers. It carries the signed-in user's session, so RLS applies (§8.3).
 *
 * Calling `cookies()` makes the caller dynamic: under Cache Components, call this only inside a
 * component wrapped in <Suspense> (README "Next.js 16.4"), or in a Server Function / Route Handler.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicEnv } from "./env";

export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. proxy.ts refreshes the session on every request, so
          // ignoring the write here is safe.
        }
      },
    },
  });
}
