// Shared demo accounts for judges (lib/demo-accounts.ts): which public accounts the sign-in page offers, and which
// addresses the server treats as demo accounts. Synthetic addresses only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEMO_ACCOUNT_REFUSAL, demoAccountEmails, isDemoAccountEmail, parseDemoAccounts, parseDemoEmailList } from "../../demo-accounts";

const CREATOR = { creatorEmail: "creator@demo.test", creatorPassword: "demo-pass-1" };
const INCOMING = { incomingEmail: "incoming@demo.test", incomingPassword: "demo-pass-2" };

describe("parseDemoAccounts (NEXT_PUBLIC_BATON_DEMO_*)", () => {
  it("nothing set: no accounts, so the sign-in page shows no panel", () => {
    assert.deepEqual(parseDemoAccounts({}), []);
    assert.deepEqual(parseDemoAccounts({ creatorEmail: "", creatorPassword: "", incomingEmail: " ", incomingPassword: " " }), []);
  });

  it("both accounts, creator first, with the button labels", () => {
    const a = parseDemoAccounts({ ...INCOMING, ...CREATOR });
    assert.deepEqual(
      a.map((x) => [x.role, x.label, x.email, x.password]),
      [
        ["creator", "Sign in as the handover creator", "creator@demo.test", "demo-pass-1"],
        ["incoming", "Sign in as the incoming member", "incoming@demo.test", "demo-pass-2"],
      ],
    );
  });

  it("an account needs both an email and a password", () => {
    assert.deepEqual(parseDemoAccounts({ creatorEmail: "creator@demo.test" }), []);
    assert.deepEqual(parseDemoAccounts({ creatorPassword: "x" }), []);
    assert.deepEqual(parseDemoAccounts({ creatorEmail: "not-an-email", creatorPassword: "x" }), []);
    assert.deepEqual(parseDemoAccounts({ ...INCOMING }).map((x) => x.role), ["incoming"]);
  });

  it("trims the email but keeps the password exactly", () => {
    const [a] = parseDemoAccounts({ creatorEmail: "  creator@demo.test ", creatorPassword: " pw " });
    assert.equal(a.email, "creator@demo.test");
    assert.equal(a.password, " pw ");
  });
});

describe("demo account emails (BATON_DEMO_EMAILS plus the public ones)", () => {
  it("parses a comma-separated, case-insensitive list and drops junk", () => {
    assert.deepEqual(parseDemoEmailList(undefined), []);
    assert.deepEqual(parseDemoEmailList(""), []);
    assert.deepEqual(parseDemoEmailList(" A@Demo.test, ,b@demo.test,nope,"), ["a@demo.test", "b@demo.test"]);
  });

  it("the public demo emails always count", () => {
    const set = demoAccountEmails({
      BATON_DEMO_EMAILS: "extra@demo.test",
      NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL: "Creator@Demo.test",
      NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL: " incoming@demo.test ",
    });
    assert.deepEqual([...set].sort(), ["creator@demo.test", "extra@demo.test", "incoming@demo.test"]);
  });

  it("isDemoAccountEmail matches case-insensitively and never matches a missing email", () => {
    const env = { BATON_DEMO_EMAILS: "judge@demo.test", NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL: "creator@demo.test" };
    assert.equal(isDemoAccountEmail("JUDGE@demo.test", env), true);
    assert.equal(isDemoAccountEmail(" creator@demo.test ", env), true);
    assert.equal(isDemoAccountEmail("someone@example.test", env), false);
    assert.equal(isDemoAccountEmail(null, env), false);
    assert.equal(isDemoAccountEmail("", env), false);
    assert.equal(isDemoAccountEmail("judge@demo.test", {}), false, "nothing configured: no demo accounts");
  });

  it("isDemoAccountEmail reads the environment at call time", () => {
    const before = process.env.BATON_DEMO_EMAILS;
    try {
      process.env.BATON_DEMO_EMAILS = "late@demo.test";
      assert.equal(isDemoAccountEmail("late@demo.test"), true);
      delete process.env.BATON_DEMO_EMAILS;
      assert.equal(isDemoAccountEmail("late@demo.test"), false);
    } finally {
      if (before === undefined) delete process.env.BATON_DEMO_EMAILS;
      else process.env.BATON_DEMO_EMAILS = before;
    }
  });

  it("the refusal is short, plain and has no em dash", () => {
    assert.equal(DEMO_ACCOUNT_REFUSAL, "This is a shared demo account, so this action is turned off.");
    assert.ok(!DEMO_ACCOUNT_REFUSAL.includes("—"));
  });
});
