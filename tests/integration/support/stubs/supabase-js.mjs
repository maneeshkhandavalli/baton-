// Stub of the "@supabase/supabase-js" platform package (approved by the lead, W1). `createClient` is what
// lib/supabase/admin.ts uses for the service-role client: here its `rpc` and `storage` forward to the
// RecordingDb / RecordingStorage installed with installBackends() (platform.ts), so the real
// lib/actions → lib/db → lib/supabase code runs unmodified and every database call is recorded.
// Nothing is sent over the network. The key the client was created with is recorded (never printed).

function backends() {
  const b = globalThis.__batonIt?.backends;
  if (!b) throw new Error("@supabase/supabase-js stub: call installBackends() first");
  return b;
}

export function createClient(url, key, options) {
  globalThis.__batonIt ??= {};
  (globalThis.__batonIt.adminClients ??= []).push({ url, keyLength: typeof key === "string" ? key.length : 0, options });
  return {
    rpc: (fn, args) => backends().adminDb.rpc(fn, args),
    storage: { from: (bucket) => backends().adminStorage.from(bucket) },
    from() {
      throw new Error("@supabase/supabase-js stub: direct table access is not part of Baton (every write is a SQL function)");
    },
    auth: {
      admin: new Proxy({}, { get: (_, name) => () => { throw new Error(`@supabase/supabase-js stub: auth.admin.${String(name)} is not emulated`); } }),
    },
  };
}
