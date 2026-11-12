// Regression tests for the security fixes: H1/N1 (verified actor), H2/N4/N5 (recovery-manifest gate),
// H3 (confirmed-email invites), M1 (trusted site URL), M5 (measured uploads) and M6 (rate limits).
// No database: a fake DbClient records calls.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canRedeemInvitation, type VerifiedActor } from "../actor-rules";
import type { DbClient } from "../client";
import { DbError } from "../errors";
import {
  createHandover,
  eraseParticipant,
  peekMemberInvite,
  purgeHandover,
  redeemMemberInvite,
  reviewPoint,
  submitGapAnswersWithToken,
} from "../mutations";
import { clientSubject } from "../rate-limit";
import { registerManifestReceiptVerifier, type ManifestReceipt } from "../recovery-gate";
import { confirmSourceUpload, downloadVerifiedRawSource, measureBytes, type StorageClient } from "../storage";
import { generateRawToken, sha256Hex } from "../tokens";
import { parseSiteUrl } from "../../supabase/site-url";

const USER = "44444444-4444-4444-8444-444444444444";
const H = "11111111-1111-4111-8111-111111111111";
const EVENT = "55555555-5555-4555-8555-555555555555";
const S = "66666666-6666-4666-8666-666666666666";
const CLAIM = { jobId: "77777777-7777-4777-8777-777777777777", attempt: 1 };
const HASH = "ab".repeat(32);

type Responses = Record<string, { data?: unknown; error?: { code?: string; message: string } }>;
function fakeDb(responses: Responses = {}) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const db: DbClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const r = responses[fn] ?? { data: fn === "consume_rate_limit" ? true : null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { db, calls };
}

// Tests may mint actors directly (boundaries.test.ts allows casts only here and in lib/db/actor.ts).
const actor = (emailConfirmed: boolean, email: string | null = "a@example.test") =>
  ({ profileId: USER, email, emailConfirmed }) as VerifiedActor;
const confirmed = actor(true);
const unconfirmed = actor(false);
const isCode = (code: string) => (e: unknown) => e instanceof DbError && e.code === code;

describe("H1/N1: verified actors", () => {
  it("every mutation passes the verified actor id as p_actor_profile_id", async () => {
    const { db, calls } = fakeDb({ create_handover: { data: H } });
    await createHandover(db, confirmed, { title: "Treasurer", teamName: "Robotics", creatorRole: "outgoing" });
    assert.equal(calls[0]?.args?.p_actor_profile_id, USER);
    await reviewPoint(db, confirmed, { action: "reject", pointId: H, reason: "dup" });
    assert.deepEqual(calls[1], { fn: "reject_point", args: { p_actor_profile_id: USER, p_point_id: H, p_reason: "dup" } });
  });
});

describe("H3: invitations need a confirmed address", () => {
  it("canRedeemInvitation requires a confirmed, present email", () => {
    assert.equal(canRedeemInvitation(confirmed), true);
    assert.equal(canRedeemInvitation(unconfirmed), false);
    assert.equal(canRedeemInvitation(actor(true, null)), false);
    assert.equal(canRedeemInvitation(null), false);
  });

  it("refuses an unconfirmed actor before redeeming (the attempt is still rate-counted)", async () => {
    const { db, calls } = fakeDb();
    await assert.rejects(redeemMemberInvite(db, unconfirmed, generateRawToken(), "203.0.113.7"), isCode("token_invalid"));
    assert.ok(calls.every((c) => c.fn === "consume_rate_limit"), "only rate counters were touched");
  });

  it("sends only the token hash and profile id, never an email", async () => {
    const { db, calls } = fakeDb({ redeem_member_invite: { data: { handover_id: H, role: "incoming", member_id: S } } });
    const member = await redeemMemberInvite(db, confirmed, generateRawToken(), null);
    assert.equal(member.role, "incoming");
    const redeem = calls.find((c) => c.fn === "redeem_member_invite");
    assert.deepEqual(Object.keys(redeem?.args ?? {}).sort(), ["p_profile_id", "p_token_hash"]);
  });
});

describe("H2/N4/N5: erasure and purge need a bound recovery-manifest receipt", () => {
  const erasureReceipt: ManifestReceipt = {
    kind: "participant_erasure", eventId: EVENT, handoverId: H, recordedAt: "2026-11-11T10:00:00Z", proof: "mac",
    identityHashHex: HASH, pepperVersion: "p1", identityKind: "phone", scopeSourceId: null,
  };
  const nameReceipt: ManifestReceipt = { ...erasureReceipt, identityKind: "name", scopeSourceId: S };
  const purgeReceipt: ManifestReceipt = { kind: "handover_purge", eventId: EVENT, handoverId: H, recordedAt: "2026-11-11T10:00:00Z", proof: "mac" };
  const erase = (
    db: DbClient,
    r: ManifestReceipt,
    identityHashHex = HASH,
    target: { identityKind: "phone" | "name"; scopeSourceId: string | null } = { identityKind: "phone", scopeSourceId: null },
  ) => eraseParticipant(db, confirmed, { erasureId: EVENT, handoverId: H, identityHashHex, pepperVersion: "p1", ...target, receipt: r });

  // Order matters: the gate is a process-wide singleton with no reset (N5).
  it("fails closed while no lib/recovery verifier is registered (D27 open)", async () => {
    const { db, calls } = fakeDb();
    await assert.rejects(erase(db, erasureReceipt), isCode("precondition_failed"));
    await assert.rejects(purgeHandover(db, { eventId: EVENT, handoverId: H, actor: null, receipt: purgeReceipt }), isCode("precondition_failed"));
    assert.equal(calls.length, 0, "the database is never called");
  });

  it("registers once; a second registration (a replacement attempt) throws", () => {
    registerManifestReceiptVerifier((r) => r.proof === "mac");
    assert.throws(() => registerManifestReceiptVerifier(() => true), /already registered/);
  });

  it("N4: an erasure receipt authorises only its own identity hash and pepper version", async () => {
    const { db, calls } = fakeDb();
    await assert.rejects(erase(db, erasureReceipt, "cd".repeat(32)), isCode("precondition_failed"), "another participant");
    await assert.rejects(erase(db, { ...erasureReceipt, pepperVersion: "p2" as "p1" }), isCode("precondition_failed"), "another pepper");
    await assert.rejects(erase(db, { ...erasureReceipt, eventId: S }), isCode("precondition_failed"), "another event");
    await assert.rejects(erase(db, { ...erasureReceipt, handoverId: S }), isCode("precondition_failed"), "another handover");
    await assert.rejects(erase(db, purgeReceipt), isCode("precondition_failed"), "a purge receipt");
    await assert.rejects(erase(db, { ...erasureReceipt, proof: "forged" }), isCode("precondition_failed"), "verifier refuses");
    assert.equal(calls.length, 0);
  });

  it("R8: an erasure receipt is bound to the identity kind and the scope source", async () => {
    const { db, calls } = fakeDb();
    const name = { identityKind: "name" as const, scopeSourceId: S };
    await assert.rejects(erase(db, erasureReceipt, HASH, name), isCode("precondition_failed"), "phone receipt for a name erasure");
    await assert.rejects(erase(db, nameReceipt, HASH), isCode("precondition_failed"), "name receipt for a phone erasure");
    await assert.rejects(erase(db, { ...nameReceipt, scopeSourceId: H }, HASH, name), isCode("precondition_failed"), "another source");
    await assert.rejects(erase(db, { ...nameReceipt, scopeSourceId: null }, HASH, name), isCode("precondition_failed"), "unscoped name receipt");
    await assert.rejects(erase(db, { ...erasureReceipt, scopeSourceId: S }, HASH), isCode("precondition_failed"), "scoped phone receipt");
    await assert.rejects(erase(db, nameReceipt, HASH, { identityKind: "name", scopeSourceId: null }), isCode("validation_failed"),
      "a name erasure must name its source");
    assert.equal(calls.length, 0);
  });

  it("N4: a purge receipt carrying an identity is refused; an erasure receipt cannot purge", async () => {
    const { db, calls } = fakeDb();
    await assert.rejects(purgeHandover(db, { eventId: EVENT, handoverId: H, actor: null, receipt: { ...purgeReceipt, identityHashHex: HASH } as unknown as ManifestReceipt }),
      isCode("precondition_failed"));
    await assert.rejects(purgeHandover(db, { eventId: EVENT, handoverId: H, actor: null, receipt: erasureReceipt }), isCode("precondition_failed"));
    await assert.rejects(purgeHandover(db, { eventId: EVENT, handoverId: H, actor: null,
      receipt: { ...purgeReceipt, identityKind: "phone" } as unknown as ManifestReceipt }), isCode("precondition_failed"));
    assert.equal(calls.length, 0);
  });

  it("calls the database only with a matching, verified receipt", async () => {
    const { db, calls } = fakeDb({ erase_participant: { data: { quotesDeleted: 1, alreadyApplied: false } } });
    await erase(db, { ...erasureReceipt, identityHashHex: HASH.toUpperCase() });
    assert.equal(calls[0]?.fn, "erase_participant");
    assert.equal(calls[0]?.args?.p_erasure_id, EVENT);
    assert.equal(calls[0]?.args?.p_identity_kind, "phone");
    assert.equal(calls[0]?.args?.p_scope_source_id, null);
    await erase(db, nameReceipt, HASH, { identityKind: "name", scopeSourceId: S });
    assert.equal(calls[1]?.args?.p_identity_kind, "name");
    assert.equal(calls[1]?.args?.p_scope_source_id, S, "a name erasure is sent with its one source");
  });

  it("a throwing verifier fails closed (fresh gate instance)", async () => {
    // A separate module instance (query string), so this test's registration cannot affect the shared gate.
    const freshGateSpecifier = "../recovery-gate.ts?throwing";
    const gate = (await import(freshGateSpecifier)) as typeof import("../recovery-gate");
    gate.registerManifestReceiptVerifier(() => {
      throw new Error("store unreachable");
    });
    await assert.rejects(
      gate.assertManifestReceipt(erasureReceipt, {
        kind: "participant_erasure", eventId: EVENT, handoverId: H, identityKind: "phone", identityHashHex: HASH, pepperVersion: "p1",
        scopeSourceId: null,
      }),
      isCode("precondition_failed"),
    );
  });
});

describe("M1: trusted site URL", () => {
  it("accepts only bare https origins (or http for localhost)", () => {
    assert.equal(parseSiteUrl("https://baton.example.org"), "https://baton.example.org");
    assert.equal(parseSiteUrl("https://baton.example.org/"), "https://baton.example.org");
    assert.equal(parseSiteUrl("http://localhost:3000"), "http://localhost:3000");
    for (const bad of [
      undefined, "", "baton.example.org", "http://baton.example.org", "https://baton.example.org/app",
      "https://user:pw@baton.example.org", "https://baton.example.org/?next=/x", "https://baton.example.org/#x",
      "javascript:alert(1)", "ftp://baton.example.org",
    ]) {
      assert.equal(parseSiteUrl(bad), null, String(bad));
    }
  });
});

describe("M6: rate limits are consumed before token operations", () => {
  it("hashes client IPs; the raw IP never reaches the database", async () => {
    const subject = await clientSubject("203.0.113.7");
    assert.match(subject ?? "", /^[0-9a-f]{64}$/);
    assert.equal(await clientSubject(null), null);
    const { db, calls } = fakeDb({ peek_member_invite: { data: { recipient_email: "x@example.test", handover_id: H } } });
    await peekMemberInvite(db, generateRawToken(), "203.0.113.7");
    assert.ok(!JSON.stringify(calls).includes("203.0.113.7"));
    assert.deepEqual(calls.map((c) => c.fn), ["consume_rate_limit", "consume_rate_limit", "peek_member_invite"]);
    assert.deepEqual(calls.slice(0, 2).map((c) => c.args?.p_scope), ["invite_magic_link_client", "invite_magic_link_token"]);
  });

  it("counts a token by the same SHA-256 the database stores", async () => {
    const raw = generateRawToken();
    const { db, calls } = fakeDb({ submit_gap_answers_with_token: { data: 1 } });
    await submitGapAnswersWithToken(db, { rawToken: raw, answererLabel: "Guest", answers: [{ gapQuestionId: S, answerText: "x" }], clientIp: null });
    assert.equal(calls[0]?.args?.p_scope, "gap_interview_submit_token");
    assert.equal(calls[0]?.args?.p_subject, await sha256Hex(raw));
    assert.equal(calls[1]?.args?.p_token_hash, `\\x${await sha256Hex(raw)}`);
  });

  it("refuses once over the limit, without running the protected operation", async () => {
    const { db, calls } = fakeDb({ consume_rate_limit: { data: false } });
    await assert.rejects(
      submitGapAnswersWithToken(db, { rawToken: generateRawToken(), answererLabel: "G", answers: [{ gapQuestionId: S, answerText: "x" }], clientIp: "198.51.100.1" }),
      (e: unknown) => e instanceof DbError && e.code === "rate_limited" && e.retryable,
    );
    await assert.rejects(redeemMemberInvite(db, confirmed, generateRawToken(), null), isCode("rate_limited"));
    assert.ok(calls.every((c) => c.fn === "consume_rate_limit"));
  });
});

describe("M5: uploads are measured, never trusted", () => {
  const bytes = new TextEncoder().encode("WhatsApp chat export");

  function fakeStorage(content: Uint8Array | null) {
    const removed: string[][] = [];
    const storage: StorageClient = {
      from: () => ({
        createSignedUploadUrl: async () => ({ data: null, error: { message: "unused" } }),
        download: async () => (content ? { data: new Blob([content as unknown as ArrayBuffer]), error: null } : { data: null, error: { message: "missing" } }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { data: null, error: null };
        },
      }),
    };
    return { storage, removed };
  }

  it("measures size and SHA-256 of the bytes the server holds", async () => {
    const m = await measureBytes(new TextEncoder().encode("abc"));
    assert.deepEqual(m, { sizeBytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  });

  it("confirms with the MEASURED values, not the declared ones", async () => {
    const measured = await measureBytes(bytes);
    const { db, calls } = fakeDb({ source_upload_target: { data: { raw_storage_path: `raw/${H}/${S}`, size_bytes: 1, sha256: "00" } } });
    await confirmSourceUpload(db, fakeStorage(bytes).storage, confirmed, S);
    assert.deepEqual(calls[1], {
      fn: "confirm_source_uploaded",
      args: { p_actor_profile_id: USER, p_source_id: S, p_measured_size: measured.sizeBytes, p_measured_sha256_hex: measured.sha256 },
    });
  });

  it("deletes the object when the database reports a mismatch", async () => {
    const { db } = fakeDb({
      source_upload_target: { data: { raw_storage_path: `raw/${H}/${S}`, size_bytes: 1, sha256: "00" } },
      confirm_source_uploaded: { error: { code: "BTVF0", message: "mismatch" } },
    });
    const { storage, removed } = fakeStorage(bytes);
    await assert.rejects(confirmSourceUpload(db, storage, confirmed, S), isCode("validation_failed"));
    assert.deepEqual(removed, [[`raw/${H}/${S}`]]);
  });

  it("reports a missing upload as precondition_failed", async () => {
    const { db } = fakeDb({ source_upload_target: { data: { raw_storage_path: `raw/${H}/${S}`, size_bytes: 1, sha256: "00" } } });
    await assert.rejects(confirmSourceUpload(db, fakeStorage(null).storage, confirmed, S), isCode("precondition_failed"));
  });

  it("the parse job refuses bytes that differ from the confirmed checksum and marks the source failed", async () => {
    const { db, calls } = fakeDb({
      raw_source_for_processing: { data: { raw_storage_path: `raw/${H}/${S}`, size_bytes: bytes.byteLength, sha256: "ff".repeat(32), state: "uploaded" } },
    });
    await assert.rejects(downloadVerifiedRawSource(db, fakeStorage(bytes).storage, S, CLAIM), isCode("validation_failed"));
    assert.deepEqual(calls[1], { fn: "pipeline_mark_source_parse_failed", args: { p_job_id: CLAIM.jobId, p_attempt: CLAIM.attempt, p_error_code: "integrity_mismatch" } });
  });

  it("the parse job returns verified bytes", async () => {
    const m = await measureBytes(bytes);
    const { db } = fakeDb({
      raw_source_for_processing: { data: { raw_storage_path: `raw/${H}/${S}`, size_bytes: m.sizeBytes, sha256: m.sha256, state: "uploaded" } },
    });
    assert.deepEqual(await downloadVerifiedRawSource(db, fakeStorage(bytes).storage, S, CLAIM), bytes);
  });
});
