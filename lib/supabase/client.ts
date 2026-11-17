/**
 * Browser Supabase client for ONE purpose: uploading a file to a signed upload URL (§10 step 2).
 *
 * R3 Task 02 (PRIV-4): it has NO session. Session cookies are httpOnly (cookie-options.ts), so page
 * JavaScript cannot read them, and this client neither reads nor stores one (no cookies, no localStorage, no
 * refresh). The upload is authorised by the single-use token the server issued with the user's own storage
 * client (lib/db/storage.ts createSourceUpload, after the role, lifecycle and source-limit checks), not by the
 * browser's identity. UI code must not query data with it (§11.1).
 */

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "./env";

export function createSupabaseUploadClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
