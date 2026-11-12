// IT-07 (action side), IT-09 (through the actions) and the D35 action contract, on the REAL Server
// Functions (lib/actions/*.ts → actionDeps() → lib/db → lib/supabase) over Recording* backends:
//   * no session → `unauthenticated` and not a single database, storage or drain call, for every action;
//   * invalid input → `validation_failed`, likewise with no call;
//   * identity never comes from the input: smuggled actor/role fields are ignored;
//   * starting processing and draining never approves, publishes or transitions anything (§9, D1);
//   * erasure and account deletion are fail-closed (D27): precondition_failed before any call.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import type { Result } from "../../lib/contracts/api";
import * as account from "../../lib/actions/account";
import * as gaps from "../../lib/actions/gaps";
import * as handovers from "../../lib/actions/handovers";
import * as members from "../../lib/actions/members";
import * as privacy from "../../lib/actions/privacy";
import * as review from "../../lib/actions/review";
import * as sources from "../../lib/actions/sources";
import { ACTOR, WRITE_RPCS, actionWorld, allCalls, type ActionWorld } from "./support/actions";
import { allowFakeAi, flushAfter, pendingAfter } from "./support/platform";
import { pointDetailRow, sourceRow } from "./support/rows";

type Call = (w: ActionWorld) => Promise<Result<unknown>>;

/** Every exported Server Function, with a VALID input. */
const ACTIONS: Record<string, Call> = {
  createHandover: () => handovers.createHandover({ title: "Robotics handover", teamName: "Robotics", creatorRole: "outgoing" }),
  startProcessing: (w) => handovers.startProcessing({ handoverId: w.ids.handover }),
  cancelProcessing: (w) => handovers.cancelProcessing({ handoverId: w.ids.handover }),
  publishHandover: (w) => handovers.publishHandover({ handoverId: w.ids.handover, summary: "Summary" }),
  startRevision: (w) => handovers.startRevision({ handoverId: w.ids.handover }),
  deleteHandover: (w) => handovers.deleteHandover({ handoverId: w.ids.handover }),
  offerCreatorTransfer: (w) => handovers.offerCreatorTransfer({ handoverId: w.ids.handover, toMemberId: w.ids.member }),
  respondToCreatorTransfer: (w) => handovers.respondToCreatorTransfer({ handoverId: w.ids.handover, accept: true }),
  createSourceUpload: (w) => sources.createSourceUpload({ handoverId: w.ids.handover, kind: "whatsapp_export", fileName: "chat.txt",
    mimeType: "text/plain", sizeBytes: 10, sha256: "ab".repeat(32) }),
  confirmSourceUploaded: (w) => sources.confirmSourceUploaded({ sourceId: w.ids.source }),
  previewSource: (w) => sources.previewSource({ sourceId: w.ids.source }),
  recordSourceConsent: (w) => sources.recordSourceConsent({ sourceId: w.ids.source, consentStatementVersion: "c@1", consentConfirmed: true,
    accessLevel: "everyone", timezone: "Asia/Kolkata" }),
  addExclusion: (w) => sources.addExclusion({ kind: "date_range", sourceId: w.ids.source, scope: "source",
    rangeStart: "2026-01-01T00:00:00Z", rangeEnd: "2026-01-02T00:00:00Z" }),
  confirmIdentityMatch: (w) => sources.confirmIdentityMatch({ sourceId: w.ids.source, exclusionId: randomUUID(), decision: "same_person" }),
  removeSource: (w) => sources.removeSource({ sourceId: w.ids.source }),
  createGapQuestion: (w) => gaps.createGapQuestion({ handoverId: w.ids.handover, category: "owner", question: "Who?", priority: "optional",
    accessLevel: "everyone" }),
  createGapInterviewLink: (w) => gaps.createGapInterviewLink({ handoverId: w.ids.handover, questionIds: [w.ids.question],
    maxAccessLevel: "everyone", expiresInDays: 7 }),
  revokeAccessToken: (w) => gaps.revokeAccessToken({ tokenId: w.ids.token }),
  submitGapAnswers: (w) => gaps.submitGapAnswers({ answers: [{ gapQuestionId: w.ids.question, answerText: "An answer" }] }),
  reviewGapAnswer: (w) => gaps.reviewGapAnswer({ answerId: w.ids.answer, decision: "accept" }),
  inviteMember: (w) => members.inviteMember({ handoverId: w.ids.handover, email: "new.member@example.org", role: "incoming", expiresInDays: 7 }),
  updateMemberClearance: (w) => members.updateMemberClearance({ memberId: w.ids.member, clearance: "leads_only" }),
  removeMember: (w) => members.removeMember({ memberId: w.ids.member }),
  acknowledgePublication: () => members.acknowledgePublication({ publicationId: randomUUID(), statementVersion: "ack@1" }),
  reviewPoint: (w) => review.reviewPoint({ action: "reject", pointId: w.ids.point, reason: "Not accurate" }),
  createManualPoint: (w) => review.createManualPoint({ handoverId: w.ids.handover, category: "decision", title: "T", statement: "S",
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] } }),
  eraseParticipant: (w) => privacy.eraseParticipant({ handoverId: w.ids.handover, participantId: randomUUID(), confirm: true }),
  deleteAccount: (w) => account.deleteAccount({ confirm: "DELETE", purgeHandoverIds: [w.ids.handover] }),
  getAccountDeletionBlockers: () => account.getAccountDeletionBlockers(),
};

function noCalls(w: ActionWorld, label: string) {
  assert.deepEqual(allCalls(w), [], `${label}: no database call`);
  assert.deepEqual([...w.adminStorage.ops, ...w.userStorage.ops], [], `${label}: no storage call`);
  assert.equal(pendingAfter(), 0, `${label}: nothing scheduled`);
}

describe("D35: every Server Function requires the verified session before anything else", () => {
  for (const [name, call] of Object.entries(ACTIONS)) {
    it(`${name}: signed out → unauthenticated, no call`, async () => {
      const w = actionWorld(false);
      allowFakeAi();
      const result = await call(w);
      assert.ok(!result.ok);
      assert.equal(result.error.code, "unauthenticated", `${name}: ${JSON.stringify(result.error)}`);
      noCalls(w, name);
    });
  }

  it("an expired or invalid session is the same as none", async () => {
    const w = actionWorld(false);
    const result = await handovers.deleteHandover({ handoverId: w.ids.handover });
    assert.ok(!result.ok && result.error.code === "unauthenticated");
    noCalls(w, "deleteHandover");
  });
});

describe("D35: invalid input is refused before the session or the database is consulted", () => {
  const INVALID: Array<[string, () => Promise<Result<unknown>>]> = [
    ["deleteHandover with a non-uuid", () => handovers.deleteHandover({ handoverId: "../../etc" })],
    ["createHandover without a creator role", () => handovers.createHandover({ title: "Title", teamName: "Team" } as never)],
    ["reviewPoint with an unknown action", () => review.reviewPoint({ action: "approve_all", pointId: randomUUID() } as never)],
    ["createGapInterviewLink with 60-day expiry", () => gaps.createGapInterviewLink({ handoverId: randomUUID(), questionIds: [randomUUID()],
      maxAccessLevel: "everyone", expiresInDays: 60 })],
    ["deleteAccount with the wrong word", () => account.deleteAccount({ confirm: "delete" as "DELETE", purgeHandoverIds: [] })],
    ["eraseParticipant without confirm", () => privacy.eraseParticipant({ handoverId: randomUUID(), participantId: randomUUID() } as never)],
    ["token answers without a name", () => gaps.submitGapAnswers({ token: "x".repeat(43), answers: [{ gapQuestionId: randomUUID(), answerText: "a" }] })],
  ];
  for (const [label, call] of INVALID) {
    it(label, async () => {
      const w = actionWorld();
      const result = await call();
      assert.ok(!result.ok);
      assert.equal(result.error.code, "validation_failed", JSON.stringify(result.error));
      noCalls(w, label);
    });
  }
});

describe("D35: identity, role and creator never come from the browser", () => {
  const SMUGGLED = { actorProfileId: randomUUID(), p_actor_profile_id: randomUUID(), profileId: randomUUID(), createdBy: randomUUID(),
    role: "creator", isCreator: true, viewerIsCreator: true };

  it("smuggled identity fields are ignored; the RPC carries the verified actor", async () => {
    const w = actionWorld();
    w.adminDb.returns("reject_point", null).returns("delete_handover", null).returns("publish_handover", randomUUID());
    w.userDb.returns("api_get_point", pointDetailRow(w.ids.point));
    await review.reviewPoint({ action: "reject", pointId: w.ids.point, reason: "No", ...SMUGGLED } as never);
    await handovers.deleteHandover({ handoverId: w.ids.handover, ...SMUGGLED } as never);
    await handovers.publishHandover({ handoverId: w.ids.handover, ...SMUGGLED } as never);
    for (const fn of ["reject_point", "delete_handover", "publish_handover"]) {
      const args = w.adminDb.last(fn)?.args;
      assert.ok(args, `${fn} was called`);
      assert.equal(args.p_actor_profile_id, ACTOR, `${fn}: actor from the session`);
      assert.doesNotMatch(JSON.stringify(args), new RegExp(Object.values(SMUGGLED).filter((v) => typeof v === "string").join("|")));
    }
  });
});

describe("IT-07 (action side): processing never approves or publishes", () => {
  it("startProcessing + the scheduled drain call no review, publication or lifecycle function", async () => {
    const w = actionWorld();
    allowFakeAi();
    w.userDb.returns("api_list_sources", [sourceRow(w.ids.source, w.ids.handover, { state: "parsed" })]);
    w.adminDb.returns("start_processing", randomUUID()).returns("claim_ready_processing_jobs", [])
      .returns("list_finishable_runs", []); // DB-15: read-only sweep the drain starts with
    const result = await handovers.startProcessing({ handoverId: w.ids.handover });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(await flushAfter(), 1, "the drain ran after the response");
    const writes = w.adminDb.fns().filter((fn) => (WRITE_RPCS as readonly string[]).includes(fn));
    assert.deepEqual(writes, ["start_processing"], "the only write is the run itself");
    assert.deepEqual(w.adminDb.unexpected, []);
  });
});

describe("IT-09 (through the actions): erasure and account deletion are fail-closed while D27 is open", () => {
  for (const [label, call] of [
    ["eraseParticipant", ACTIONS.eraseParticipant],
    ["deleteAccount with a purge list", ACTIONS.deleteAccount],
    ["deleteAccount with nothing to purge", () => account.deleteAccount({ confirm: "DELETE", purgeHandoverIds: [] })],
  ] as Array<[string, Call]>) {
    it(`${label}: precondition_failed (recovery_manifest_unavailable), no call of any kind`, async () => {
      const w = actionWorld();
      const result = await call(w);
      assert.ok(!result.ok);
      assert.equal(result.error.code, "precondition_failed");
      assert.equal(result.error.details?.reason, "recovery_manifest_unavailable");
      assert.equal(result.error.retryable, false);
      noCalls(w, label);
    });
  }

  it("getAccountDeletionBlockers still works, as an RLS read only", async () => {
    const w = actionWorld();
    w.userDb.returns("get_account_deletion_blockers", [{ id: w.ids.handover, title: "Mine", deleted: false }]);
    const result = await account.getAccountDeletionBlockers();
    assert.deepEqual(result, { ok: true, data: { createdHandovers: [{ id: w.ids.handover, title: "Mine", deleted: false }] } });
    assert.deepEqual(w.adminDb.fns(), []);
  });
});
