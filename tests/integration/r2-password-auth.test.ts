// Round 2: email + password sign-in through the real Server Functions, with the @supabase/ssr stub recording auth
// calls (nothing is sent; passwords are never recorded). Proves: sign-in, sign-up and "forgot or never set a
// password?" never reveal whether an address has an account; links return only to BATON_SITE_URL (authCallbackUrl); `next` is
// sanitised; the signed-in password change needs a session; provider text is never shown or logged.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { sendPasswordSetupLink, signInWithPassword, signUpWithPassword } from "../../app/(auth)/login/actions";
import { setPassword } from "../../app/(workspace)/account/password/actions";
import { captureConsole } from "./support/console-capture";
import { authCalls, resetPlatform, setPasswordStub, signInAs, SITE_URL } from "./support/platform";

const PW = "correct horse battery"; // synthetic
const calls = (name: string) => authCalls().filter((c) => c.name === name).map((c) => c.args as Record<string, unknown>);

describe("password sign-in", () => {
  beforeEach(() => resetPlatform());

  it("signs in through Supabase and never records the password", async () => {
    const r = await signInWithPassword("  Someone@Example.test ", PW);
    assert.deepEqual(r, { status: "ok" });
    const [c] = calls("signInWithPassword");
    assert.equal(c.email, "Someone@Example.test");
    assert.equal(c.password, "[set]");
    assert.ok(!JSON.stringify(authCalls()).includes(PW));
  });

  it("validates before calling Supabase", async () => {
    assert.equal((await signInWithPassword("not-an-email", PW)).status, "error");
    assert.equal((await signInWithPassword("a@example.test", "")).status, "error");
    assert.equal(calls("signInWithPassword").length, 0);
  });

  it("wrong password and unknown address get the same answer (no account enumeration)", async () => {
    setPasswordStub({ signIn: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" } });
    const r = await signInWithPassword("a@example.test", "wrong-password");
    assert.equal(r.status, "error");
    assert.match(r.status === "error" ? r.message : "", /don't match/);
    assert.ok(!/no account|not found|doesn't exist/i.test(r.status === "error" ? r.message : ""));
  });

  it("rate limits and unexpected failures show fixed text; provider text is never shown or logged", async () => {
    setPasswordStub({ signIn: { message: "provider secret detail", status: 429, code: "over_request_rate_limit" } });
    const limited = await signInWithPassword("a@example.test", PW);
    assert.match(limited.status === "error" ? limited.message : "", /Too many attempts/);
    setPasswordStub({ signIn: { message: "provider secret detail", status: 500, code: "unexpected_failure" } });
    const { result, lines } = await captureConsole(() => signInWithPassword("a@example.test", PW));
    assert.equal(result.status, "error");
    assert.ok(!JSON.stringify(result).includes("provider secret detail"));
    assert.ok(!JSON.stringify(lines).includes("provider secret detail"));
    assert.ok(!JSON.stringify(lines).includes(PW));
  });
});

describe("password sign-up", () => {
  beforeEach(() => resetPlatform());

  it("checks the password pair, then asks Supabase with a confirmation link built only from BATON_SITE_URL", async () => {
    assert.equal((await signUpWithPassword("a@example.test", "short", "short", null)).status, "error");
    assert.equal((await signUpWithPassword("a@example.test", PW, PW + "x", null)).status, "error");
    assert.equal(calls("signUp").length, 0);

    const r = await signUpWithPassword("a@example.test", PW, PW, "/handover/new");
    assert.equal(r.status, "ok");
    const [c] = calls("signUp");
    assert.equal(c.password, "[set]");
    const back = new URL((c.options as { emailRedirectTo: string }).emailRedirectTo);
    assert.equal(back.origin, SITE_URL);
    assert.equal(back.pathname, "/auth/callback");
    assert.equal(back.searchParams.get("next"), "/handover/new");
  });

  it("an unsafe `next` is dropped", async () => {
    await signUpWithPassword("a@example.test", PW, PW, "https://evil.example/x");
    const back = new URL((calls("signUp")[0].options as { emailRedirectTo: string }).emailRedirectTo);
    assert.equal(back.searchParams.get("next"), null);
  });

  it("a new address and an existing one get the same answer", async () => {
    const fresh = await signUpWithPassword("new@example.test", PW, PW, null);
    setPasswordStub({ signUp: { message: "User already registered", status: 422, code: "user_already_exists" } });
    const existing = await signUpWithPassword("old@example.test", PW, PW, null);
    assert.deepEqual(existing, fresh);
    assert.ok(fresh.status === "ok" && fresh.message);
  });

  it("signs straight in only when Supabase returns a session", async () => {
    setPasswordStub({ signUpSession: true });
    assert.deepEqual(await signUpWithPassword("a@example.test", PW, PW, null), { status: "ok" });
  });
});

describe("forgot or never set a password", () => {
  beforeEach(() => resetPlatform());

  it("emails a link back to /account/password on BATON_SITE_URL, with the same answer for every address", async () => {
    const ok = await sendPasswordSetupLink("a@example.test");
    const [c] = calls("resetPasswordForEmail");
    const back = new URL((c.options as { redirectTo: string }).redirectTo);
    assert.equal(back.origin, SITE_URL);
    assert.equal(back.searchParams.get("next"), "/account/password");

    setPasswordStub({ reset: { message: "provider detail", status: 400, code: "unexpected_failure" } });
    const { result: failed } = await captureConsole(() => sendPasswordSetupLink("b@example.test"));
    assert.deepEqual(failed, ok, "a provider failure must not reveal anything about the address");
  });

  it("validates the address", async () => {
    assert.equal((await sendPasswordSetupLink("nope")).status, "error");
    assert.equal(calls("resetPasswordForEmail").length, 0);
  });
});

describe("setting a password while signed in", () => {
  beforeEach(() => resetPlatform());

  it("needs a session", async () => {
    const r = await setPassword(PW, PW);
    assert.equal(r.status, "error");
    assert.equal(calls("updateUser").length, 0);
  });

  it("sets the password for the signed-in account only", async () => {
    signInAs("11111111-1111-4111-8111-111111111111");
    assert.equal((await setPassword(PW, PW)).status, "ok");
    assert.equal(calls("updateUser")[0].password, "[set]");
  });

  it("explains Supabase's password rules without provider text", async () => {
    signInAs("11111111-1111-4111-8111-111111111111");
    setPasswordStub({ update: { message: "provider detail", status: 422, code: "same_password" } });
    const r = await setPassword(PW, PW);
    assert.equal(r.status, "error");
    assert.ok(r.status === "error" && r.field === "password" && !r.message.includes("provider detail"));
  });
});
