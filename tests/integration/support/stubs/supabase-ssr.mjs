// Stub of the "@supabase/ssr" platform package. Only the auth surface is emulated:
//   * auth.getUser() returns the user set with signInAs() (platform.ts), as the Supabase Auth server would
//     after validating the session, so lib/db/actor.getVerifiedActor() mints actors through its real code;
//   * auth.signInWithOtp() / exchangeCodeForSession() / verifyOtp() / signOut() are recorded, never sent.
// The user-scoped (RLS) client's `rpc` and `storage` forward to the user RecordingDb / RecordingStorage
// installed with installBackends() (platform.ts); without them they throw. `from` is never emulated.

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
    rpc(fn, args) {
      const b = state().backends;
      if (!b) return unsupported("rpc (call installBackends first)")();
      return b.userDb.rpc(fn, args);
    },
    from: unsupported("from"),
    storage: {
      from(bucket) {
        const b = state().backends;
        if (!b) return unsupported("storage (call installBackends first)")();
        return b.userStorage.from(bucket);
      },
    },
  };
}

export function createServerClient() {
  return client("server");
}

export function createBrowserClient() {
  return client("browser");
}
