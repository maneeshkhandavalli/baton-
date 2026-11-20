// F3 (21 Nov): the shared demo accounts are public, so they may not add content or start paid AI work. Every
// guarded action refuses a demo account with `forbidden` (reason demo_account_content) BEFORE any database, Storage
// or AI call. Ordinary accounts reach the action body as before. Review and publish stay open to demo accounts so
// judges can explore the seeded handovers. All writes go through these server actions: the authenticated role has
// no table write grants (supabase/migrations), so this is the enforcement point.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { VerifiedActor } from "../../db/actor-rules";
import { DEMO_CONTENT_REFUSAL } from "../../demo-accounts";
import * as gaps from "../core/gaps";
import * as handovers from "../core/handovers";
import * as review from "../core/review";
import * as sources from "../core/sources";
import { ACTOR, ACTOR_ID, H, fakeDeps } from "./helpers";

const S = "44444444-4444-4444-8444-444444444444";
const SHA = "a".repeat(64);
const DEMO = Object.freeze({ profileId: ACTOR_ID, email: "Judge.Creator@Demo.test", emailConfirmed: true }) as VerifiedActor;
const PUBLIC_DEMO = Object.freeze({ profileId: ACTOR_ID, email: "incoming@demo.test", emailConfirmed: true }) as VerifiedActor;

const KEYS = ["BATON_DEMO_EMAILS", "NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL", "NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.BATON_DEMO_EMAILS = "judge.creator@demo.test";
  process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL = "incoming@demo.test";
  delete process.env.NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

type R = { ok: boolean; error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } };

const GUARDED: Array<[string, (deps: ReturnType<typeof fakeDeps>["deps"]) => Promise<unknown>]> = [
  ["createHandover", (d) => handovers.createHandover(d, { title: "Season", teamName: "Club", creatorRole: "outgoing" })],
  ["startProcessing", (d) => handovers.startProcessing(d, { handoverId: H })],
  ["startRevision", (d) => handovers.startRevision(d, { handoverId: H })],
  ["deleteHandover", (d) => handovers.deleteHandover(d, { handoverId: H })],
  [
    "createSourceUpload",
    (d) => sources.createSourceUpload(d, { handoverId: H, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain", sizeBytes: 100, sha256: SHA }),
  ],
  [
    "createSourceVersionUpload",
    (d) => sources.createSourceVersionUpload(d, { previousSourceId: S, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain", sizeBytes: 120, sha256: SHA }),
  ],
  ["confirmSourceUploaded", (d) => sources.confirmSourceUploaded(d, { sourceId: S })],
  [
    "recordSourceConsent",
    (d) => sources.recordSourceConsent(d, { sourceId: S, consentStatementVersion: "local-test-2026-11-18-v1", consentConfirmed: true, timezone: "Asia/Kolkata" }),
  ],
  ["removeSource", (d) => sources.removeSource(d, { sourceId: S })],
  // owner decision 21 Nov: a judge's added point or question would show to every later judge
  [
    "createManualPoint",
    (d) => review.createManualPoint(d, { handoverId: H, category: "contact", title: "Groundsman", statement: "Books the ground", testimony: { text: "I called him" }, attributes: { nameLabel: "Groundsman" } }),
  ],
  ["createGapQuestion", (d) => gaps.createGapQuestion(d, { handoverId: H, question: "Who has the hall keys?", priority: "required" })],
];

describe("F3: shared demo accounts can't add content or start paid AI work", () => {
  for (const [name, call] of GUARDED) {
    it(`${name} refuses both demo accounts before any database, Storage or AI call`, async () => {
      for (const actor of [DEMO, PUBLIC_DEMO]) {
        const f = fakeDeps({ actor });
        const r = (await call(f.deps)) as R;
        assert.equal(r.ok, false);
        assert.equal(r.error?.code, "forbidden");
        assert.equal(r.error?.message, DEMO_CONTENT_REFUSAL);
        assert.equal(r.error?.retryable, false);
        assert.equal(r.error?.details?.reason, "demo_account_content");
        assert.deepEqual(f.calls, [], `${name} touched the database for a demo account`);
        assert.deepEqual(f.storageCalls, [], `${name} touched Storage for a demo account`);
      }
    });

    it(`${name} is not refused for an ordinary account`, async () => {
      const f = fakeDeps({ actor: ACTOR });
      const r = (await call(f.deps)) as R;
      assert.notEqual(r.error?.details?.reason, "demo_account_content");
    });
  }

  it("the refusal message tells judges what still works and where to go", () => {
    assert.match(DEMO_CONTENT_REFUSAL, /review and publish/);
    assert.match(DEMO_CONTENT_REFUSAL, /no-sign-in demo/);
    assert.doesNotMatch(DEMO_CONTENT_REFUSAL, /[–—]/);
  });

  it("review and publish stay open to demo accounts (judges can still finish the seeded handover)", async () => {
    const f = fakeDeps({ actor: DEMO, rpc: { publish_handover: { data: { publication_id: S, version: 2 } } } });
    const r = (await handovers.publishHandover(f.deps, { handoverId: H, summary: "Second version" })) as R;
    assert.notEqual(r.error?.details?.reason, "demo_account_content");
    assert.ok(f.calls.length > 0, "publish reached the database for a demo account");
  });
});
