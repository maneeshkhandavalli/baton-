import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PASSWORD_PAGE_COPY, isRecentRecovery, needsCurrentPassword, passwordPageMode, RECOVERY_WINDOW_SECONDS } from "../../account/password-mode";

const now = 1_800_000_000;
const recovery = [{ method: "recovery", timestamp: now - 60 }];
const otpLink = [{ method: "otp", timestamp: now - 60 }];
const passwordSignIn = [{ method: "password", timestamp: now - 10 }];
const staleRecovery = [{ method: "recovery", timestamp: now - RECOVERY_WINDOW_SECONDS - 1 }];

// Round 4 audit A2: Set vs Change password, with reauthentication for a change.
describe("password page mode", () => {
  it("Google-only accounts set a password; accounts with one change it", () => {
    assert.equal(passwordPageMode(false, null, now), "set");
    assert.equal(passwordPageMode(true, null, now), "change");
    assert.equal(passwordPageMode(null, null, now), "change"); // unknown: ask for the current password
    assert.equal(PASSWORD_PAGE_COPY.set.title, "Set a password");
    assert.equal(PASSWORD_PAGE_COPY.change.title, "Change your password");
  });

  it("changing needs the current password, except right after a recovery link", () => {
    assert.equal(needsCurrentPassword(false, null, now), false);
    assert.equal(needsCurrentPassword(true, null, now), true);
    assert.equal(needsCurrentPassword(true, passwordSignIn, now), true);
    assert.equal(needsCurrentPassword(true, recovery, now), false);
    assert.equal(needsCurrentPassword(true, otpLink, now), true); // an emailed sign-in code is not a password reset
    assert.equal(needsCurrentPassword(true, staleRecovery, now), true);
    assert.equal(needsCurrentPassword(true, [{ method: "recovery", timestamp: now + 60 }], now), true, "a future timestamp is not recent");
    assert.equal(isRecentRecovery("recovery", now), false);
    assert.equal(isRecentRecovery([{ method: "recovery", timestamp: "x" }], now), false);
    assert.equal(isRecentRecovery([{ method: "oauth", timestamp: now }], now), false);
  });

  // Audit fix: hasPassword null (the check threw) used to skip the current password (fail open).
  it("unknown whether a password exists: the current password is required unless it's a recovery sign-in", () => {
    assert.equal(needsCurrentPassword(null, null, now), true);
    assert.equal(needsCurrentPassword(null, passwordSignIn, now), true);
    assert.equal(needsCurrentPassword(null, staleRecovery, now), true);
    assert.equal(needsCurrentPassword(null, recovery, now), false);
  });

  // Audit fix: the "Forgot" email link lands on /account/password; the page used to ask for the current password.
  it("right after a recovery link the page shows the new-password form, never the current-password one", () => {
    for (const has of [true, null] as const) {
      assert.equal(passwordPageMode(has, recovery, now), "reset");
      assert.notEqual(passwordPageMode(has, otpLink, now), "reset");
      assert.equal(passwordPageMode(has, staleRecovery, now), "change");
    }
    assert.equal(passwordPageMode(false, recovery, now), "set");
    assert.equal(PASSWORD_PAGE_COPY.reset.title, "Set a new password");
    assert.doesNotMatch(PASSWORD_PAGE_COPY.reset.description, /current|Forgot/i);
  });

  it("the page and the server decide with the same rule: the form asks for the current password exactly when it's required", () => {
    const amrs = [null, recovery, otpLink, passwordSignIn, staleRecovery];
    for (const has of [true, false, null] as const) {
      for (const amr of amrs) assert.equal(passwordPageMode(has, amr, now) === "change", needsCurrentPassword(has, amr, now), JSON.stringify({ has, amr }));
    }
  });

  it("copy is plain: no em dashes", () => {
    for (const c of Object.values(PASSWORD_PAGE_COPY)) assert.ok(!Object.values(c).join(" ").includes("—"));
  });

  it("the server action checks the current password before saving, on a cookie-less client", () => {
    const action = readFileSync(join(process.cwd(), "app/(workspace)/account/password/actions.ts"), "utf8");
    assert.match(action, /needsCurrentPassword\(hasPassword, amr,/);
    assert.match(action, /readSessionAmr\(supabase\)/);
    assert.match(action, /persistSession: false/);
    const check = action.indexOf("currentPasswordMatches(user.email, current)");
    assert.ok(check > 0 && check < action.indexOf("return setOwnPassword(password, confirm)"));
    assert.ok(action.indexOf("isDemoAccountEmail(user.email)") < check, "demo accounts are refused before any check");
  });

  it("the page reads the same session claims and rule as the action", () => {
    const page = readFileSync(join(process.cwd(), "app/(workspace)/account/password/page.tsx"), "utf8");
    assert.match(page, /readSessionAmr\(\)/);
    assert.match(page, /passwordPageMode\(overview\?\.hasPassword \?\? null, amr, nowSeconds\(\)\)/);
    const form = readFileSync(join(process.cwd(), "app/(workspace)/account/password/set-password-form.tsx"), "utf8");
    assert.match(form, /mode === "change" && \(/, "only the change form has the current-password field");
  });
});
