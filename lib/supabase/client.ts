/**
 * Browser Supabase client (§12.3). User-scoped: RLS applies to everything it can reach. UI code should
 * not query data with it (UI imports only lib/data, §11.1); it exists for client-side auth state and for
 * uploading a file to a signed upload URL.
 */

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv } from "./env";

export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
