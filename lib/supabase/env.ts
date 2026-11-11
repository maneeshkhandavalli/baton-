/**
 * Supabase configuration (§12.5). NEXT_PUBLIC_* values are inlined at build time, so they are read with
 * literal `process.env.X` expressions. Supports both the legacy anon key and the newer publishable key.
 * No production project or credentials are assumed (§13.2.12): every agent uses its own dev project.
 */

export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

export function getSupabasePublicEnv(): SupabasePublicEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return { url, anonKey };
}

/** True when the public Supabase variables are present (lets pages render a setup notice instead of crashing). */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  );
}
