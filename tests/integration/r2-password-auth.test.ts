// Round 2: email + password sign-in through the real Server Functions, with the @supabase/ssr stub recording auth
// calls (nothing is sent; passwords are never recorded). Proves: sign-in, sign-up and "forgot or never set a
// password?" never reveal whether an address has an account; links return only to BATON_SITE_URL (authCallbackUrl); `next` is
// sanitised; the signed-in password change needs a session; provider text is never shown or logged.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { sendPasswordSetupLink, signInWithPassword, signUpWithPassword } from "../../app/(auth)/login/actions";
import { setPassword } from "../../app/(workspace)/account/password/actions";
import { captureConsole } from "./support/console-capture";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SetPasswordForm } from "../../app/(workspace)/account/password/set-password-form";
import { authCalls, installBackends, resetPlatform, setPasswordStub, setSessionAmr, signInAs, SITE_URL } from "./support/platform";

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
    installBackends().adminDb.returns("account_has_password", false); // e.g. Google only: no current password
    assert.equal((await setPassword(PW, PW)).status, "ok");
    assert.equal(calls("updateUser")[0].password, "[set]");
  });

  it("explains Supabase's password rules without provider text", async () => {
    signInAs("11111111-1111-4111-8111-111111111111");
    installBackends().adminDb.returns("account_has_password", false);
    setPasswordStub({ update: { message: "provider detail", status: 422, code: "same_password" } });
    const r = await setPassword(PW, PW);
    assert.equal(r.status, "error");
    assert.ok(r.status === "error" && r.field === "password" && !r.message.includes("provider detail"));
  });
});

// Audit fixes: (1) the "Forgot" email link lands on /account/password, which must then offer the new-password form
// without the current password; (2) when whether a password exists can't be read, the current password is required
// (and checked) unless this is a recent recovery sign-in, and a check that can't be done refuses (retryable).
describe("changing a password: the current password", () => {
  const USER = "11111111-1111-4111-8111-111111111111";
  const NOW = () => Math.floor(Date.now() / 1000);
  const GENERIC = { status: "error", message: "Something went wrong on our side. Please try again." };
  const updates = () => calls("updateUser").length;
  const probes = () => authCalls().filter((c) => c.client === "probe" && c.name === "signInWithPassword").length;
  beforeEach(() => {
    resetPlatform();
    signInAs(USER);
  });
  const hasPassword = (value: boolean | "unknown") => {
    const { adminDb } = installBackends();
    if (value === "unknown") adminDb.fails("account_has_password", "XX000");
    else adminDb.returns("account_has_password", value);
  };

  it("an account with a password must give the current one; a wrong one is refused", async () => {
    hasPassword(true);
    assert.deepEqual(await setPassword(PW, PW), { status: "error", field: "current", message: "Enter your current password." });
    setPasswordStub({ current: { message: "provider detail", status: 400, code: "invalid_credentials" } });
    const wrong = await setPassword(PW, PW, "not it");
    assert.ok(wrong.status === "error" && wrong.field === "current" && !wrong.message.includes("provider detail"));
    assert.equal(updates(), 0);
    setPasswordStub(null);
    assert.equal((await setPassword(PW, PW, "the old one")).status, "ok");
    assert.equal(updates(), 1);
  });

  it("right after a recovery link: no current password needed (\"recovery\" only; an \"otp\" sign-in code is not a reset)", async () => {
    for (const method of ["recovery"]) {
      resetPlatform();
      signInAs(USER);
      hasPassword(true);
      setSessionAmr([{ method, timestamp: NOW() - 30 }]);
      assert.equal((await setPassword(PW, PW)).status, "ok", method);
      assert.equal(probes(), 0, "nothing to check");
      assert.equal(updates(), 1);
    }
  });

  it("a stale recovery sign-in, or a password sign-in, still needs the current password", async () => {
    hasPassword(true);
    for (const amr of [[{ method: "recovery", timestamp: NOW() - 2 * 60 * 60 }], [{ method: "password", timestamp: NOW() - 5 }]]) {
      setSessionAmr(amr);
      assert.deepEqual(await setPassword(PW, PW), { status: "error", field: "current", message: "Enter your current password." });
    }
    assert.equal(updates(), 0);
  });

  it("unknown whether a password exists: fails closed, the current password is required and checked", async () => {
    hasPassword("unknown");
    setSessionAmr([{ method: "password", timestamp: NOW() - 5 }]);
    assert.deepEqual(await setPassword(PW, PW), { status: "error", field: "current", message: "Enter your current password." });
    setPasswordStub({ current: { message: "provider detail", status: 400, code: "invalid_credentials" } });
    const wrong = await setPassword(PW, PW, "not it");
    assert.ok(wrong.status === "error" && wrong.field === "current");
    assert.equal(updates(), 0, "a stolen session cannot change it");
    setPasswordStub(null);
    assert.equal((await setPassword(PW, PW, "the old one")).status, "ok");
    assert.equal(probes(), 2);
    assert.equal(updates(), 1);
  });

  it("a check that can't be done refuses with a retryable error, never allows", async () => {
    for (const has of [true, "unknown"] as const) {
      resetPlatform();
      signInAs(USER);
      hasPassword(has);
      setPasswordStub({ current: "throw" });
      const { result, lines } = await captureConsole(() => setPassword(PW, PW, "the old one"));
      assert.deepEqual(result, GENERIC, String(has));
      setPasswordStub({ current: { message: "provider detail", status: 500, code: "unexpected_failure" } });
      const failed = await captureConsole(() => setPassword(PW, PW, "the old one"));
      assert.deepEqual(failed.result, GENERIC);
      assert.equal(updates(), 0);
      const logged = [...lines, ...failed.lines].join("\n");
      assert.ok(!logged.includes("the old one") && !logged.includes("provider detail"), "no password or provider text logged");
    }
  });

  it("unknown whether a password exists, right after a recovery link: the new password is set", async () => {
    hasPassword("unknown");
    setSessionAmr([{ method: "recovery", timestamp: NOW() - 30 }]);
    assert.equal((await setPassword(PW, PW)).status, "ok");
    assert.equal(updates(), 1);
  });

  it("the form: \"reset\" (after a recovery link) and \"set\" have no current-password field; \"change\" has one", () => {
    const html = (mode: "set" | "change" | "reset") => renderToStaticMarkup(createElement(SetPasswordForm, { mode }));
    for (const mode of ["reset", "set"] as const) {
      assert.ok(!html(mode).includes('name="current"'), mode);
      assert.ok(!html(mode).includes("Current password"), mode);
    }
    assert.match(html("reset"), />Save new password</);
    assert.match(html("change"), /<input id="current-password"[^>]*required=""[^>]*name="current"/);
    for (const mode of ["reset", "set", "change"] as const) assert.ok(!html(mode).includes("\u2014"), "no em dashes");
  });
});
