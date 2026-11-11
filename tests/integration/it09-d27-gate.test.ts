// IT-09 (TypeScript half): participant erasure and handover purge stay fail-closed while D27 is open
// (§8.3, §12.8, D27, H2/N4/N5). No recovery-manifest verifier exists, so every receipt — absent, forged,
// or perfectly shaped — is refused with precondition_failed BEFORE any database call. The database half
// (no role may EXECUTE erase_participant / purge_handover) is tests/integration/db/sql/it09_privileges.sql.
//
// This file deliberately never references the verifier registration function (boundaries.test.ts N5).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { getVerifiedActor } from "../../lib/db/actor";
import { isDbError, toAppError } from "../../lib/db/errors";
import { eraseParticipant, purgeHandover } from "../../lib/db/mutations";
import type { ManifestReceipt } from "../../lib/db/recovery-gate";
import { resetPlatform, signInAs } from "./support/platform";
import { RecordingDb } from "./support/recording-db";

const ANN = "0b6a1c1e-1f00-4c3b-9d7a-0000000000a1";
const HASH = "ab".repeat(32);

async function actor() {
  signInAs(ANN);
  const a = await getVerifiedActor();
  assert.ok(a);
  return a;
}

function erasureReceipt(over: Partial<Extract<ManifestReceipt, { kind: "participant_erasure" }>> = {}, ids = { eventId: randomUUID(), handoverId: randomUUID() }) {
  return {
    kind: "participant_erasure" as const,
    eventId: ids.eventId,
    handoverId: ids.handoverId,
    recordedAt: "2026-11-12T00:00:00Z",
    proof: "forged-but-well-formed",
    identityHashHex: HASH,
    pepperVersion: "p1" as const,
    identityKind: "phone" as const,
    scopeSourceId: null,
    ...over,
  };
}

const isPrecondition = (e: unknown) => isDbError(e) && e.code === "precondition_failed";

beforeEach(() => resetPlatform());

describe("IT-09: erasure is refused without a verified manifest receipt", () => {
  it("absent, forged and exactly-matching receipts are all refused, and the database is never called", async () => {
    const a = await actor();
    const eventId = randomUUID();
    const handoverId = randomUUID();
    const target = { erasureId: eventId, handoverId, identityKind: "phone" as const, identityHashHex: HASH, pepperVersion: "p1" as const, scopeSourceId: null };
    const receipts: unknown[] = [
      null,
      undefined,
      {},
      erasureReceipt(), // other ids
      erasureReceipt({}, { eventId, handoverId }), // matches the operation exactly; still no verifier
      erasureReceipt({ identityHashHex: "cd".repeat(32) }, { eventId, handoverId }),
      { ...erasureReceipt({}, { eventId, handoverId }), kind: "handover_purge" },
    ];
    for (const receipt of receipts) {
      const db = new RecordingDb();
      await assert.rejects(eraseParticipant(db, a, { ...target, receipt: receipt as ManifestReceipt }), isPrecondition);
      assert.deepEqual(db.fns(), [], "no erasure_target, erase_participant or any other RPC");
    }
  });

  it("a name erasure must name its one source; a phone erasure none (validated before anything else)", async () => {
    const a = await actor();
    const db = new RecordingDb();
    await assert.rejects(
      eraseParticipant(db, a, {
        erasureId: randomUUID(), handoverId: randomUUID(), identityKind: "name", identityHashHex: HASH, pepperVersion: "p1",
        scopeSourceId: null, receipt: erasureReceipt({ identityKind: "name" }),
      }),
      (e) => isDbError(e) && e.code === "validation_failed",
    );
    assert.deepEqual(db.fns(), []);
  });

  it("the client sees a fixed, content-free precondition_failed", async () => {
    const a = await actor();
    const error = await eraseParticipant(new RecordingDb(), a, {
      erasureId: randomUUID(), handoverId: randomUUID(), identityKind: "phone", identityHashHex: HASH, pepperVersion: "p1",
      scopeSourceId: null, receipt: erasureReceipt(),
    }).catch((e: unknown) => e);
    const app = toAppError(error);
    assert.equal(app.code, "precondition_failed");
    assert.equal(app.retryable, false);
    assert.equal(app.details, undefined);
    assert.doesNotMatch(JSON.stringify(app), new RegExp(HASH));
  });
});

describe("IT-09: handover purge is refused without a verified manifest receipt", () => {
  for (const who of ["the creator (account deletion)", "the retention sweep (no actor)"]) {
    it(who, async () => {
      const a = who.startsWith("the creator") ? await actor() : null;
      const eventId = randomUUID();
      const handoverId = randomUUID();
      for (const receipt of [null, { kind: "handover_purge", eventId, handoverId, recordedAt: "2026-11-12T00:00:00Z", proof: "x" }]) {
        const db = new RecordingDb();
        await assert.rejects(purgeHandover(db, { eventId, handoverId, actor: a, receipt: receipt as ManifestReceipt }), isPrecondition);
        assert.deepEqual(db.fns(), [], "purge_handover is never called");
      }
    });
  }
});
