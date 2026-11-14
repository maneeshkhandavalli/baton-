// Stub of the "@supabase/ssr" platform package. Only the auth surface is emulated:
//   * auth.getUser() returns the user set with signInAs() (platform.ts), as the Supabase Auth server would
//     after validating the session, so lib/db/actor.getVerifiedActor() mints actors through its real code;
//   * auth.signInWithOtp() / signInWithOAuth() / signInWithPassword() / signUp() / resetPasswordForEmail() /
//     updateUser() / exchangeCodeForSession() / verifyOtp() / signOut() are recorded,
//     never sent. signInWithOAuth returns an authorize URL on NEXT_PUBLIC_SUPABASE_URL unless the test sets
//     `oauth` ({ url?, error? }) on the platform state.
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
      async signInWithOAuth(args) {
        record("signInWithOAuth", args);
        const o = state().oauth ?? {};
        if (o.error) return { data: { provider: args?.provider, url: null }, error: o.error };
        const url = o.url ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/authorize?provider=${args?.provider}`;
        return { data: { provider: args?.provider, url }, error: null };
      },
      // Password auth: arguments are recorded with the password replaced, so no test log ever holds one.
      // `state().password` ({ signIn?, signUp?, reset?, update? } each an error, plus signUpSession) shapes the result.
      async signInWithPassword(args) {
        record("signInWithPassword", { email: args?.email, password: args?.password ? "[set]" : "" });
        return { data: {}, error: state().password?.signIn ?? null };
      },
      async signUp(args) {
        record("signUp", { email: args?.email, password: args?.password ? "[set]" : "", options: args?.options });
        const p = state().password ?? {};
        if (p.signUp) return { data: { user: null, session: null }, error: p.signUp };
        return { data: { user: { id: "stub-new-user" }, session: p.signUpSession ? { access_token: "stub" } : null }, error: null };
      },
      async resetPasswordForEmail(email, options) {
        record("resetPasswordForEmail", { email, options });
        return { data: {}, error: state().password?.reset ?? null };
      },
      async updateUser(attrs) {
        record("updateUser", { password: attrs?.password ? "[set]" : undefined });
        return { data: { user: state().user ?? null }, error: state().password?.update ?? null };
      },
      async exchangeCodeForSession(code) {
        record("exchangeCodeForSession", { code });
        return { data: {}, error: state().exchangeError ?? null };
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
