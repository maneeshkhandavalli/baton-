// R3 C2/C3 (Agent 2): createHandover resubmission, the duplicate-upload conflict and the typed refusal of
// unauthorised access on every handover-scoped action. No database, no Next.js; synthetic data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Result } from "../../contracts/api";
import type { HandoverSummary } from "../../contracts/dto";
import * as gaps from "../core/gaps";
import * as handovers from "../core/handovers";
import * as members from "../core/members";
import * as review from "../core/review";
import * as sources from "../core/sources";
import { ACTOR_ID, FAKE_RUN_CONFIG, H, P, S, fakeDeps, type RpcHandler } from "./helpers";

const UPDATED_AT = "2026-11-12T10:00:00.123Z";

const summary = (over: Partial<HandoverSummary> = {}): HandoverSummary => ({
  id: H,
  title: "Treasurer handover",
  teamName: "Robotics Club",
  roleTitle: null,
  state: "draft",
  viewerRole: "outgoing",
  viewerIsCreator: true,
  viewerClearance: "reviewer_only",
  currentPublicationId: null,
  pendingCreatorTransfer: null,
  createdAt: "2026-11-12T09:00:00.000Z",
  updatedAt: "2026-11-12T10:00:05.456Z",
  ...over,
});

const okResult = <T>(data: T) => async (): Promise<Result<T>> => ({ ok: true, data });
const dbError = (code: string): RpcHandler => ({ error: { code, message: `raw SQL detail for ${code}` } });

const validEdit = { handoverId: H, title: "Treasurer handover", teamName: "Robotics Club", expectedUpdatedAt: UPDATED_AT };

describe("createHandover resubmission (R3 C2)", () => {
  it("a repeated identical submission returns the draft the database hands back (same id, one RPC each)", async () => {
    const f = fakeDeps({ rpc: { create_handover: { data: H } }, queries: { getHandover: okResult(summary()) } });
    const input = { title: "Treasurer handover", teamName: "Robotics Club", creatorRole: "outgoing" } as const;
    const [a, b] = await Promise.all([handovers.createHandover(f.deps, input), handovers.createHandover(f.deps, input)]);
    assert.deepEqual(a, b);
    assert.equal(a.ok && a.data.id, H);
    assert.deepEqual(f.fns(), ["create_handover", "create_handover"]);
    assert.deepEqual(f.calls[0].args, f.calls[1].args, "masking is deterministic, so the database can match the resubmission");
  });
});

describe("duplicate upload (R3 C3)", () => {
  const upload = { handoverId: H, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain", sizeBytes: 10, sha256: "ab".repeat(32) } as const;

  it("C5: a retried unfinished upload gets a fresh ticket for the source create_source hands back", async () => {
    // create_source returns the reused pending source's id (or the id of the row that replaced it).
    const f = fakeDeps({ rpc: { create_source: { data: S } } });
    const first = await sources.createSourceUpload(f.deps, upload);
    const retry = await sources.createSourceUpload(f.deps, { ...upload, fileName: "chat (1).txt" });
    assert.ok(first.ok && retry.ok);
    assert.equal(retry.data.sourceId, S);
    assert.deepEqual(f.fns(), ["create_source", "create_source"]);
    assert.deepEqual(f.storageCalls, [
      { op: "createSignedUploadUrl", path: `raw/${H}/${S}` },
      { op: "createSignedUploadUrl", path: `raw/${H}/${S}` },
    ], "each attempt signs a fresh ticket for the same path");
    assert.equal(f.calls[1].args?.p_sha256_hex, "ab".repeat(32));
  });

  it("the (handover, sha256) duplicate is a friendly typed conflict and nothing is signed", async () => {
    const f = fakeDeps({ rpc: { create_source: dbError("BTCF0") } });
    const r = await sources.createSourceUpload(f.deps, upload);
    assert.ok(!r.ok);
    assert.equal(r.error.code, "conflict");
    assert.equal(r.error.details?.reason, sources.DUPLICATE_SOURCE_REASON);
    assert.equal(r.error.message, sources.DUPLICATE_SOURCE_MESSAGE);
    assert.ok(!r.error.message.includes("raw SQL"));
    assert.deepEqual(f.storageCalls, []);
    assert.equal(f.refreshes, 0);
  });

  it("other create_source failures keep their own codes", async () => {
    for (const [state, code] of [["BTPF0", "precondition_failed"], ["BTIT0", "invalid_transition"], ["BTNF0", "not_found"], ["BTFB0", "forbidden"]] as const) {
      const f = fakeDeps({ rpc: { create_source: dbError(state) } });
      const r = await sources.createSourceUpload(f.deps, upload);
      assert.equal(!r.ok && r.error.code, code);
      assert.equal(!r.ok && r.error.details, undefined);
    }
    const retry = fakeDeps({ rpc: { create_source: dbError("55P03") } });
    const r = await sources.createSourceUpload(retry.deps, upload);
    assert.ok(!r.ok && r.error.code === "conflict" && r.error.retryable && r.error.details === undefined);
  });
});

/**
 * C3: every handover-scoped write refuses an actor who may not act with the database's typed error
 * (not_found when the handover is invisible, forbidden for the wrong role), passes it through unchanged with
 * a safe message, and neither re-reads nor refreshes.
 */
describe("unauthorised access is refused with typed errors on every handover-scoped action (R3 C3)", () => {
  type Run = (f: ReturnType<typeof fakeDeps>) => Promise<Result<unknown>>;
  const cases: Array<[string, string, Run]> = [
    ["updateHandoverDetails", "update_handover_details", (f) => handovers.updateHandoverDetails(f.deps, validEdit)],
    ["cancelProcessing", "cancel_processing", (f) => handovers.cancelProcessing(f.deps, { handoverId: H })],
    ["publishHandover", "publish_handover", (f) => handovers.publishHandover(f.deps, { handoverId: H })],
    ["startRevision", "start_revision", (f) => handovers.startRevision(f.deps, { handoverId: H })],
    ["deleteHandover", "delete_handover", (f) => handovers.deleteHandover(f.deps, { handoverId: H })],
    ["offerCreatorTransfer", "offer_creator_transfer", (f) => handovers.offerCreatorTransfer(f.deps, { handoverId: H, toMemberId: P })],
    ["respondToCreatorTransfer", "respond_to_creator_transfer", (f) => handovers.respondToCreatorTransfer(f.deps, { handoverId: H, accept: true })],
    ["createSourceUpload", "create_source", (f) => sources.createSourceUpload(f.deps, { handoverId: H, kind: "whatsapp_export", fileName: "c.txt", mimeType: "text/plain", sizeBytes: 1, sha256: "ab".repeat(32) })],
    ["confirmSourceUploaded", "source_upload_target", (f) => sources.confirmSourceUploaded(f.deps, { sourceId: S })],
    ["addExclusion", "add_exclusion", (f) => sources.addExclusion(f.deps, { kind: "date_range", sourceId: S, scope: "source", rangeStart: "2026-01-01T00:00:00Z", rangeEnd: "2026-01-02T00:00:00Z" })],
    ["confirmIdentityMatch", "confirm_identity_match", (f) => sources.confirmIdentityMatch(f.deps, { sourceId: S, exclusionId: P, decision: "same_person" })],
    ["removeSource", "remove_source", (f) => sources.removeSource(f.deps, { sourceId: S })],
    ["inviteMember", "invite_member", (f) => members.inviteMember(f.deps, { handoverId: H, email: "new@example.test", role: "incoming", expiresInDays: 7 })],
    ["updateMemberClearance", "update_member_clearance", (f) => members.updateMemberClearance(f.deps, { memberId: P, clearance: "leads_only" })],
    ["removeMember", "remove_member", (f) => members.removeMember(f.deps, { memberId: P })],
    ["acknowledgePublication", "acknowledge_publication", (f) => members.acknowledgePublication(f.deps, { publicationId: P, statementVersion: "ack@1" })],
    ["createGapQuestion", "create_gap_question", (f) => gaps.createGapQuestion(f.deps, { handoverId: H, category: "owner", question: "Who holds the keys?", priority: "optional", accessLevel: "everyone" })],
    ["createGapInterviewLink", "create_gap_interview_link", (f) => gaps.createGapInterviewLink(f.deps, { handoverId: H, questionIds: [P], maxAccessLevel: "everyone", expiresInDays: 7 })],
    ["revokeAccessToken", "revoke_access_token", (f) => gaps.revokeAccessToken(f.deps, { tokenId: P })],
    ["reviewGapAnswer", "review_gap_answer", (f) => gaps.reviewGapAnswer(f.deps, { answerId: P, decision: "accept" })],
    ["reviewPoint (reject)", "reject_point", (f) => review.reviewPoint(f.deps, { action: "reject", pointId: P, reason: "Not accurate" })],
    ["createManualPoint", "create_manual_point", (f) => review.createManualPoint(f.deps, { handoverId: H, category: "decision", title: "A title", statement: "A statement", attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] } })],
  ];

  for (const [name, fn, run] of cases) {
    for (const [state, code] of [["BTNF0", "not_found"], ["BTFB0", "forbidden"]] as const) {
      it(`${name}: ${state} → ${code}`, async () => {
        const f = fakeDeps({ rpc: { [fn]: dbError(state) }, aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }) });
        const r = await run(f);
        assert.ok(!r.ok, `${name} must fail`);
        assert.equal(r.error.code, code);
        assert.ok(!r.error.message.includes("raw SQL"), "Postgres messages never reach the client");
        assert.ok(f.calls.some((c) => c.fn === fn && c.client === "admin" && c.args?.p_actor_profile_id === ACTOR_ID));
        assert.deepEqual(f.queryCalls, [], "nothing is re-read after a refusal");
        assert.equal(f.refreshes, 0);
      });
    }
  }

  it("startProcessing on an invisible handover stops at the RLS read with not_found, before any write", async () => {
    const f = fakeDeps({ aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }) }); // listSources → not_found
    const r = await handovers.startProcessing(f.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "not_found");
    assert.deepEqual(f.calls, []);
  });

  it("reviewPoint (edit) on an invisible point stops at the RLS read, before any write", async () => {
    const f = fakeDeps(); // getPoint → not_found
    const r = await review.reviewPoint(f.deps, {
      action: "edit", pointId: P, expectedRevisionId: S, title: "T", statement: "S", attributes: {}, editReason: "Fix",
    } as never);
    assert.equal(!r.ok && r.error.code, "not_found");
    assert.deepEqual(f.queryCalls.map((q) => q.name), ["getPoint"]);
    assert.deepEqual(f.calls, []);
  });
});
