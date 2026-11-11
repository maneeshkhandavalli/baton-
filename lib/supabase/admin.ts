import "server-only";

/**
 * Service-role client (§8.3, §12.5). Bypasses RLS. Allowed ONLY in: token redemption, pipeline workers,
 * retention/purge jobs and the privacy/account functions. Even with this key the database refuses direct
 * table writes (see supabase/migrations/…_grants.sql): every write is a checked SQL function.
 */

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "./env";

export function createSupabaseAdminClient() {
  const { url } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!serviceKey) {
    throw new Error("Supabase service key is not configured (SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
