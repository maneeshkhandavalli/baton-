// Stub of the "@supabase/ssr" platform package. Only the auth surface is emulated:
//   * auth.getUser() returns the user set with signInAs() (platform.ts), as the Supabase Auth server would
//     after validating the session, so lib/db/actor.getVerifiedActor() mints actors through its real code;
//   * auth.signInWithOtp() / exchangeCodeForSession() / verifyOtp() / signOut() are recorded, never sent.
// Data access (rpc, from, storage) is deliberately NOT emulated here: lib/db is driven through its injected
// DbClient / StorageClient interfaces (RecordingDb, RecordingStorage), never through this client.

function state() {
  globalThis.__batonIt ??= {};
  globalThis.__batonIt.authCalls ??= [];
  return globalThis.__batonIt;
}

function client(kind) {
  const s = state();
  const record = (name, args) => void s.authCalls.push({ client: kind, name, args });
  const unsupported = (what) => () => {
    throw new Error(`@supabase/ssr stub: ${what} is not emulated; inject a RecordingDb/RecordingStorage instead`);
  };
  return {
    auth: {
      async getUser() {
        record("getUser");
        const user = state().user ?? null;
        if (state().authError) return { data: { user: null }, error: { message: "stub auth error", status: 401 } };
        return { data: { user }, error: null };
      },
      async getSession() {
        throw new Error("@supabase/ssr stub: getSession() must never be used for authorization (§8.3)");
      },
      async signInWithOtp(args) {
        record("signInWithOtp", args);
        return { data: {}, error: state().otpError ?? null };
      },
      async exchangeCodeForSession(code) {
        record("exchangeCodeForSession", { code });
        return { data: {}, error: null };
      },
      async verifyOtp(args) {
        record("verifyOtp", args);
        return { data: {}, error: null };
      },
      async signOut() {
        record("signOut");
        return { error: null };
      },
    },
    rpc: unsupported("rpc"),
    from: unsupported("from"),
    storage: { from: unsupported("storage") },
  };
}

export function createServerClient() {
  return client("server");
}

export function createBrowserClient() {
  return client("browser");
}
