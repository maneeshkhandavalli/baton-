/**
 * Owner decision 21 Nov (judging): the judge demo accounts can do everything an ordinary account can. Only changing
 * the password and deleting the account stay blocked, so one judge can't lock the others out.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerifiedActor } from "../../db/actor-rules";
import { DEMO_ACCOUNT_REFUSAL, DEMO_ACCOUNTS_FULL_ACCESS } from "../../demo-accounts";
import { refuseDemoInstall } from "../../connectors/providers/bots/shared";
import { refuseDemoAccount, refuseDemoContent } from "../core/demo-guard";
import * as handovers from "../core/handovers";
import { ACTOR, fakeDeps } from "./helpers";

const saved = { ...process.env };
function withDemoEnv<T>(fn: () => T): T {
  process.env.BATON_DEMO_EMAILS = "judge.creator@demo.test";
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}
const DEMO = { ...ACTOR, email: "judge.creator@demo.test" } as VerifiedActor;

describe("judges have full access (owner decision 21 Nov)", () => {
  it("the switch is on", () => assert.equal(DEMO_ACCOUNTS_FULL_ACCESS, true));

  it("content, processing and connector installs are not refused for a demo account", () =>
    withDemoEnv(() => {
      assert.equal(refuseDemoContent(DEMO), null);
      assert.equal(refuseDemoInstall({ profileId: DEMO.profileId, email: DEMO.email } as never), null);
    }));

  it("changing the password and deleting the account stay blocked for a demo account", () =>
    withDemoEnv(() => {
      const r = refuseDemoAccount(DEMO);
      assert.ok(r && !r.ok);
      assert.equal(r.error.code, "forbidden");
      assert.equal(r.error.message, DEMO_ACCOUNT_REFUSAL);
    }));

  it("a demo account's new handover reaches the database", async () => {
    await withDemoEnv(async () => {
      const f = fakeDeps({ actor: DEMO });
      const r = (await handovers.createHandover(f.deps, { title: "Season", teamName: "Club", creatorRole: "outgoing" })) as { error?: { details?: Record<string, unknown> } };
      assert.notEqual(r.error?.details?.reason, "demo_account_content");
      assert.ok(f.calls.length > 0, "createHandover reached the database for a demo account");
    });
  });
});
