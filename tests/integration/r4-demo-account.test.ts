// Round 4: shared demo accounts for judges (lib/demo-accounts.ts). The sign-in panel renders nothing unless demo
// credentials are configured, shows them as text when they are, and signs in only through the existing password
// Server Function. A signed-in demo account cannot change its password (setOwnPassword refuses before updateUser).
// Synthetic addresses and passwords only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { signInWithPassword } from "../../app/(auth)/login/actions";
import { setPassword } from "../../app/(workspace)/account/password/actions";
import { DemoAccountPanel } from "../../components/auth/demo-account-panel";
import { DEMO_ACCOUNT_REFUSAL, parseDemoAccounts } from "../../lib/demo-accounts";
import { authCalls, installBackends, resetPlatform, signInAs } from "./support/platform";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PW = "correct horse battery"; // synthetic
const accounts = parseDemoAccounts({
  creatorEmail: "creator@demo.test",
  creatorPassword: "demo-creator-pass",
  incomingEmail: "incoming@demo.test",
  incomingPassword: "demo-incoming-pass",
});
const noSignIn = async () => {
  throw new Error("not called while rendering");
};

describe("demo account panel (sign-in page)", () => {
  it("renders nothing when no demo credentials are configured", () => {
    assert.equal(renderToStaticMarkup(createElement(DemoAccountPanel, { next: null, signIn: noSignIn })), "");
    assert.equal(renderToStaticMarkup(createElement(DemoAccountPanel, { next: null, signIn: noSignIn, accounts: [] })), "");
  });

  it("with credentials: a labelled region, two real buttons and the credentials as text", () => {
    const html = renderToStaticMarkup(createElement(DemoAccountPanel, { next: "/dashboard", signIn: noSignIn, accounts }));
    assert.match(html, /role="region"/);
    assert.match(html, /<h2 id="[^"]+">Judging Baton\?<\/h2>/);
    assert.match(html, /Use a ready-made demo account with real data, no sign-up needed\./);
    assert.match(html, /<button[^>]*type="button"[^>]*>Sign in as the handover creator<\/button>/);
    assert.match(html, /<button[^>]*type="button"[^>]*>Sign in as the incoming member<\/button>/);
    for (const s of ["creator@demo.test", "demo-creator-pass", "incoming@demo.test", "demo-incoming-pass"]) assert.ok(html.includes(s), s);
    assert.match(html, /synthetic data/);
    assert.ok(!html.includes("—"), "no em dashes");
    assert.ok(!html.includes("<form"), "no new form or auth path");
  });

  it("is inserted at the top of the login form and uses the existing password Server Function", () => {
    const form = readFileSync(path.join(root, "app/(auth)/login/login-form.tsx"), "utf8");
    assert.match(form, /<DemoAccountPanel next=\{next\} signIn=\{signInWithPassword\} \/>/);
    const panel = readFileSync(path.join(root, "components/auth/demo-account-panel.tsx"), "utf8");
    assert.ok(!/@supabase|createSupabase|"use server"|signInWithPassword\(/.test(panel), "no new auth path in the panel");
    assert.ok(!panel.includes("dangerouslySetInnerHTML"));
  });
});

describe("setting a password: shared demo accounts", () => {
  const KEYS = ["BATON_DEMO_EMAILS", "NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL", "NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL"] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    resetPlatform();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.BATON_DEMO_EMAILS = "judge@demo.test";
    process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL = "incoming@demo.test";
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const updates = () => authCalls().filter((c) => c.name === "updateUser");

  it("a demo account is refused with the demo message and Supabase is never asked", async () => {
    for (const email of ["Judge@Demo.test", "incoming@demo.test"]) {
      resetPlatform();
      signInAs("11111111-1111-4111-8111-111111111111", email);
      const r = await setPassword(PW, PW);
      assert.deepEqual(r, { status: "error", message: DEMO_ACCOUNT_REFUSAL }, email);
      assert.equal(updates().length, 0);
    }
  });

  it("any other account still sets its password", async () => {
    signInAs("11111111-1111-4111-8111-111111111111", "someone@example.test");
    installBackends().adminDb.returns("account_has_password", false); // no password yet: no current one to give
    assert.equal((await setPassword(PW, PW)).status, "ok");
    assert.equal(updates().length, 1);
  });

  it("demo accounts can still sign in with the password", async () => {
    assert.deepEqual(await signInWithPassword("judge@demo.test", "demo-pass"), { status: "ok" });
  });
});
