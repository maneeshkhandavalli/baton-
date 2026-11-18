// R3 Task 06: the per-visitor, database-free demo engine (lib/demo/engine; contract §2, D1, A1).
// Run: node --import ./lib/mocks/__tests__/resolve-ui.mjs --test "lib/demo/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEMO_STEPS } from "../scenario/index";
import {
  DEMO_ENGINE_VERSION,
  DEMO_HANDOVER_ID,
  DEMO_LOG_MAX,
  DEMO_SESSION_MAX_AGE_MS,
  NOT_RECHECKED,
  applyDemoAction,
  demoPointId,
  demoQueries,
  demoSnapshot,
  jumpToStep,
  parseDemoSession,
  resetDemoSession,
  serializeDemoSession,
  startDemoSession,
  type DemoSession,
} from "../engine/index";

const H = DEMO_HANDOVER_ID;

async function data<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: unknown }>): Promise<T> {
  const r = await p;
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

const pointOf = (s: DemoSession, key: Parameters<typeof demoPointId>[0]) => data(demoQueries(s, "priya").getPoint(demoPointId(key)));

describe("demo engine: steps and the canonical journey", () => {
  it("every step builds; review is not publishable, decisions and publish are, receive is published", async () => {
    const states: Record<string, [string, boolean]> = {};
    for (const step of DEMO_STEPS.map((s) => s.id)) {
      const q = demoQueries(startDemoSession({ step }), "priya");
      const h = await data(q.getHandover(H));
      const r = await data(q.getReadiness(H));
      states[step] = [h.state, r.canPublish];
    }
    assert.deepEqual(states, {
      sources: ["in_review", false],
      draft: ["in_review", false],
      review: ["in_review", false],
      decisions: ["in_review", true],
      publish: ["in_review", true],
      receive: ["approved", true],
    });
  });

  it("the incoming member reads nothing before publication and the publication after it", async () => {
    const before = await demoQueries(startDemoSession({ step: "publish" }), "neha").getPublishedHandover(H);
    assert.equal(!before.ok && before.error.code, "not_found");
    const pub = await data(demoQueries(startDemoSession({ step: "receive" }), "neha").getPublishedHandover(H));
    assert.equal(pub.version, 1);
    assert.ok(pub.sections.length > 0);
    assert.equal(pub.viewerAcknowledgedAt, null);
  });

  it("RLS-like visibility: the incoming member sees no points or sources; the lead does not see leads-only data beyond clearance", async () => {
    const s = startDemoSession({ step: "review" });
    assert.deepEqual(await data(demoQueries(s, "neha").listPoints(H)), []);
    assert.deepEqual(await data(demoQueries(s, "neha").listSources(H)), []);
    const priya = await data(demoQueries(s, "priya").listPoints(H));
    assert.ok(priya.length >= 20);
  });

  it("demoSnapshot equals a fresh session of the same step", async () => {
    const a = await data(demoSnapshot("decisions", "priya").listPoints(H));
    const b = await data(demoQueries(startDemoSession({ step: "decisions" }), "priya").listPoints(H));
    assert.deepEqual(a, b);
  });
});

describe("demo engine: the visitor's actions (A1)", () => {
  it("approve, reject and edit work like the real review and are logged", async () => {
    let s = startDemoSession({ step: "review" });
    const fee = await pointOf(s, "workshop_fee");
    const edit = applyDemoAction(s, {
      type: "reviewPoint",
      input: { action: "edit", pointId: fee.id, expectedRevisionId: fee.currentRevisionId, title: "Workshops are free", statement: "Workshops are free for everyone; call 9876543210.", attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] }, editReason: "Changed in September" },
    });
    assert.ok(edit.result.ok, JSON.stringify(edit.result));
    s = edit.session;
    assert.equal(s.log.length, 1);
    const edited = await pointOf(s, "workshop_fee");
    assert.equal(edited.revisions.length, 2);
    assert.ok(edited.statement.includes("[PHONE_1]") && !edited.statement.includes("9876543210"), "visitor text is masked like the real product");
    assert.ok(edited.evidence.every((e) => e.verdictRationale === NOT_RECHECKED || e.excluded), "the demo says it did not re-check");

    const stale = applyDemoAction(s, { type: "reviewPoint", input: { action: "approve", pointId: fee.id, expectedRevisionId: fee.currentRevisionId } });
    assert.equal(!stale.result.ok && stale.result.error.code, "conflict", "a stale revision is refused");
    assert.equal(stale.session, s, "a failed action leaves the session unchanged");

    const t = await pointOf(s, "tshirts");
    const rej = applyDemoAction(s, { type: "reviewPoint", input: { action: "reject", pointId: t.id, reason: "One-off order" } });
    assert.ok(rej.result.ok);
    assert.equal((await pointOf(rej.session, "tshirts")).reviewState, "rejected");
    assert.equal((await pointOf(s, "tshirts")).reviewState, "pending", "the previous session object is unchanged");

    const gap = await pointOf(s, "discord_admin");
    const plain = applyDemoAction(s, { type: "reviewPoint", input: { action: "approve", pointId: gap.id, expectedRevisionId: gap.currentRevisionId } });
    assert.equal(!plain.result.ok && plain.result.error.code, "validation_failed", "a missing point needs asKnownGap, as in the product");
  });

  it("confirm_inferred and resolve_conflict (A7) work like the real review", async () => {
    const s = startDemoSession({ step: "review" });
    const weekly = await pointOf(s, "weekly_meeting");
    assert.equal(weekly.evidenceStatus, "inferred");
    const c = applyDemoAction(s, { type: "reviewPoint", input: { action: "confirm_inferred", pointId: weekly.id, note: "Every meeting was on Thursdays." } });
    assert.ok(c.result.ok, JSON.stringify(c.result));
    assert.ok((await pointOf(c.session, "weekly_meeting")).inferredConfirmation);
    const fee = await pointOf(s, "workshop_fee");
    assert.equal(fee.evidenceStatus, "conflicting");
    const r = applyDemoAction(c.session, { type: "reviewPoint", input: { action: "resolve_conflict", pointId: fee.id, resolutionNote: "The September call replaced the August fee." } });
    assert.ok(r.result.ok, JSON.stringify(r.result));
    assert.ok((await pointOf(r.session, "workshop_fee")).conflictResolution);
    const wrong = applyDemoAction(s, { type: "reviewPoint", input: { action: "resolve_conflict", pointId: weekly.id, resolutionNote: "x" } });
    assert.equal(!wrong.result.ok && wrong.result.error.code, "invalid_transition", "only a conflicting point has a conflict to resolve");
  });

  it("submitGapAnswers and reviewGapAnswer (accept: testimony evidence; reject: the question reopens)", async () => {
    const s = startDemoSession({ step: "receive" });
    const [q1, q2] = await data(demoQueries(s, "priya").listGapQuestions(H));
    const a = applyDemoAction(s, {
      type: "submitGapAnswers",
      input: { answererLabel: "Ananya Iyer", answers: [{ gapQuestionId: q1.id, answerText: "Ananya is the only admin; ping 9876543210." }, { gapQuestionId: q2.id, answerText: "Kabir has it." }] },
    });
    assert.ok(a.result.ok, JSON.stringify(a.result));
    assert.deepEqual(a.result.data, { submitted: 2 });
    const answered = await data(demoQueries(a.session, "priya").listGapQuestions(H));
    const one = answered.find((x) => x.id === q1.id)!;
    const two = answered.find((x) => x.id === q2.id)!;
    assert.equal(one.status, "answered");
    assert.ok(one.answers[0].text.includes("[PHONE_1]"), "answers are masked");
    const acc = applyDemoAction(a.session, { type: "reviewGapAnswer", input: { answerId: one.answers[0].id, decision: "accept" } });
    assert.ok(acc.result.ok);
    const p = await data(demoQueries(acc.session, "priya").getPoint(q1.pointId!));
    assert.ok(p.evidence.some((e) => e.kind === "testimony" && e.quote.includes("only admin")));
    const rej = applyDemoAction(acc.session, { type: "reviewGapAnswer", input: { answerId: two.answers[0].id, decision: "reject" } });
    assert.ok(rej.result.ok);
    assert.equal((await data(demoQueries(rej.session, "priya").listGapQuestions(H))).find((x) => x.id === q2.id)!.status, "open");
    const twice = applyDemoAction(rej.session, { type: "reviewGapAnswer", input: { answerId: one.answers[0].id, decision: "accept" } });
    assert.equal(!twice.result.ok && twice.result.error.code, "invalid_transition");
    const unknown = applyDemoAction(s, { type: "submitGapAnswers", input: { answers: [{ gapQuestionId: "00000000-0000-4000-8000-000000000009", answerText: "x" }] } });
    assert.equal(!unknown.result.ok && unknown.result.error.code, "not_found");
    const empty = applyDemoAction(s, { type: "submitGapAnswers", input: { answers: [] } });
    assert.equal(!empty.result.ok && empty.result.error.code, "validation_failed", "the real SubmitGapAnswersInput rules apply");
  });

  it("publish, then acknowledge as the incoming member", async () => {
    const s = startDemoSession({ step: "publish" });
    const pub = applyDemoAction(s, { type: "publish", input: { handoverId: H, summary: "Version 1 from the visitor." } });
    assert.ok(pub.result.ok, JSON.stringify(pub.result));
    const published = await data(demoQueries(pub.session, "neha").getPublishedHandover(H));
    const ack = applyDemoAction(pub.session, { type: "acknowledge", input: { publicationId: published.publicationId, statementVersion: "ack@demo" } });
    assert.ok(ack.result.ok);
    assert.ok((await data(demoQueries(ack.session, "neha").getPublishedHandover(H))).viewerAcknowledgedAt);
    assert.equal((await data(demoQueries(ack.session, "priya").getHandover(H))).state, "acknowledged");
    const again = applyDemoAction(ack.session, { type: "acknowledge", input: { publicationId: published.publicationId, statementVersion: "ack@demo" } });
    assert.equal(!again.result.ok && again.result.error.code, "invalid_transition");
    const notReady = applyDemoAction(startDemoSession({ step: "review" }), { type: "publish", input: { handoverId: H } });
    assert.equal(!notReady.result.ok && notReady.result.error.code, "precondition_failed", "readiness blockers apply");
  });

  it("change reviews appear after publication and follow the Task 05E decision rules", async () => {
    assert.deepEqual(await data(demoQueries(startDemoSession({ step: "publish" }), "priya").getChangeReviews(H)), [], "none before publication");
    let s = startDemoSession({ step: "receive" });
    const items = await data(demoQueries(s, "priya").getChangeReviews(H));
    assert.deepEqual(items.map((i) => i.kind).sort(), ["evidence_missing", "evidence_moved", "possible_contradiction", "support_changed"]);
    const moved = items.find((i) => i.kind === "evidence_moved")!;
    const contra = items.find((i) => i.kind === "possible_contradiction")!;
    const missing = items.find((i) => i.kind === "evidence_missing")!;
    const stale = items.find((i) => i.state === "stale")!;
    const base = { handoverId: H, expectedState: "open" as const };

    const staleTry = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: stale.id, decision: "reject", expectedPointRevisionId: stale.point!.currentRevisionId, note: "n/a" } });
    assert.equal(!staleTry.result.ok && staleTry.result.error.details?.reason, "change_review_stale", "a stale item cannot be decided");
    const shortNote = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: missing.id, decision: "accept", expectedPointRevisionId: missing.point!.currentRevisionId, note: "still true" } });
    assert.equal(!shortNote.result.ok && shortNote.result.error.code, "validation_failed", "a re-attestation needs a 20-character note");
    const attest = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: missing.id, decision: "accept", expectedPointRevisionId: missing.point!.currentRevisionId, note: "The projector still cuts out; checked in Lab 3 this week." } });
    assert.ok(attest.result.ok, JSON.stringify(attest.result));
    assert.equal((await pointOf(attest.session, "projector")).evidence.length, (await pointOf(s, "projector")).evidence.length, "no replacement evidence");
    const noCorrection = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: contra.id, decision: "accept", expectedPointRevisionId: contra.point!.currentRevisionId, note: "x" } });
    assert.equal(!noCorrection.result.ok && noCorrection.result.error.code, "validation_failed", "a contradiction needs the corrected point");

    const noNote = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: contra.id, decision: "investigate", expectedPointRevisionId: contra.point!.currentRevisionId } });
    assert.equal(!noNote.result.ok && noNote.result.error.code, "validation_failed", "investigate needs a note");
    const inv = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: contra.id, decision: "investigate", expectedPointRevisionId: contra.point!.currentRevisionId, note: "Asking IT" } });
    assert.ok(inv.result.ok);
    s = inv.session;

    const before = await pointOf(s, "github_org");
    const acc = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: moved.id, decision: "accept", expectedPointRevisionId: moved.point!.currentRevisionId } });
    assert.ok(acc.result.ok, JSON.stringify(acc.result));
    s = acc.session;
    assert.equal((await pointOf(s, "github_org")).evidence.length, before.evidence.length + 1, "accepting a move links the new quotation");
    const repeat = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: moved.id, decision: "accept", expectedPointRevisionId: moved.point!.currentRevisionId } });
    assert.ok(repeat.result.ok && (repeat.result.data as { outcome: string }).outcome === "unchanged", "repeating a decision is unchanged");
    const other = applyDemoAction(s, { type: "decideChangeReview", input: { ...base, itemId: moved.id, decision: "reject", expectedPointRevisionId: moved.point!.currentRevisionId, note: "no" } });
    assert.equal(!other.result.ok && other.result.error.code, "conflict");

    const body = contra.newMessage!.body;
    const correct = applyDemoAction(s, {
      type: "decideChangeReview",
      input: {
        handoverId: H, itemId: contra.id, decision: "accept", expectedState: "investigating", expectedPointRevisionId: contra.point!.currentRevisionId,
        note: "IT confirmed the new rule.",
        correction: { title: "Guest Wi-Fi takes two working days", statement: "Request guest Wi-Fi from college IT by Monday; it takes two working days.", attributes: { dependsOnLabel: "College IT", dependencyType: "organisation" }, evidenceStart: 0, evidenceEnd: body.length },
      },
    });
    assert.ok(correct.result.ok, JSON.stringify(correct.result));
    const wifi = await pointOf(correct.session, "guest_wifi");
    assert.equal(wifi.reviewState, "pending", "a correction sends the point back to review");
    assert.equal(wifi.title, "Guest Wi-Fi takes two working days");
  });

  it("everything else is refused as demo_read_only; a simulated invite sends nothing and is not logged", async () => {
    const s = startDemoSession({ step: "review" });
    const p = await pointOf(s, "workshop_fee");
    for (const action of [
      { type: "deleteHandover", input: { handoverId: H } },
      { type: "createSourceUpload", input: {} },
      { type: "eraseParticipant", input: {} },
      { type: "deleteAccount", input: {} },
      // A7: the ReviewPointInput actions a visitor may not take
      { type: "reviewPoint", input: { action: "change_access", pointId: p.id, accessOverride: "everyone" } },
      { type: "reviewPoint", input: { action: "reopen", pointId: p.id } },
      { type: "reviewPoint", input: { action: "exclude_evidence", pointId: p.id, pointEvidenceId: p.evidence[0].pointEvidenceId, reason: "x" } },
      { type: "reviewPoint", input: { action: "restore_evidence", pointId: p.id, pointEvidenceId: p.evidence[0].pointEvidenceId } },
      { type: "reviewPoint", input: { action: "resolve_privacy_review", pointId: p.id, decision: "keep", expectedDigest: "x" } },
      { type: "answerGapQuestion", input: {} },
      { type: "acceptGapAnswer", input: {} },
      { type: "startRevision", input: {} },
      { type: "reset", input: {} },
      "not even an object",
      null,
    ]) {
      const r = applyDemoAction(s, action);
      assert.equal(!r.result.ok && r.result.error.code, "forbidden", JSON.stringify(action));
      assert.equal(!r.result.ok && r.result.error.details?.reason, "demo_read_only");
      assert.equal(r.session, s);
    }
    const invite = applyDemoAction(s, { type: "inviteMember", input: { handoverId: H, email: "someone@example.org", role: "incoming" } });
    assert.ok(invite.result.ok);
    const created = invite.result.data as { url: string; delivery: unknown };
    assert.deepEqual(created.delivery, { status: "not_sent", reason: "demo" });
    assert.doesNotMatch(created.url, /\/h\/[A-Za-z0-9_-]{43}/, "never a real-looking invitation token");
    assert.equal(invite.session.log.length, 0);
  });

  it("caps the log", () => {
    const s: DemoSession = { ...startDemoSession({ step: "receive" }), log: Array.from({ length: DEMO_LOG_MAX }, () => ({ type: "publish", input: { handoverId: H } }) as never) };
    const r = applyDemoAction(s, { type: "publish", input: { handoverId: H } });
    assert.equal(!r.result.ok && r.result.error.details?.reason, "demo_limit_reached");
  });
});

describe("demo engine: isolation, reset, persistence", () => {
  it("two sessions never share state", async () => {
    const a = startDemoSession({ step: "review" });
    const b = startDemoSession({ step: "review" });
    assert.notEqual(a.id, b.id);
    const t = await pointOf(a, "tshirts");
    const a2 = applyDemoAction(a, { type: "reviewPoint", input: { action: "reject", pointId: t.id, reason: "x" } }).session;
    assert.equal((await pointOf(a2, "tshirts")).reviewState, "rejected");
    assert.equal((await pointOf(b, "tshirts")).reviewState, "pending");
  });

  it("reset and jump are idempotent and drop the visitor's changes; replay is deterministic", async () => {
    const s = startDemoSession({ step: "review" });
    const t = await pointOf(s, "tshirts");
    const changed = applyDemoAction(s, { type: "reviewPoint", input: { action: "reject", pointId: t.id, reason: "x" } }).session;
    const reset = resetDemoSession(changed);
    assert.deepEqual(resetDemoSession(reset), reset);
    assert.equal(reset.id, s.id);
    assert.equal((await pointOf(reset, "tshirts")).reviewState, "pending");
    assert.deepEqual(jumpToStep(jumpToStep(changed, "publish"), "publish"), jumpToStep(changed, "publish"));
    const restored = parseDemoSession(serializeDemoSession(changed))!;
    assert.deepEqual(await data(demoQueries(restored, "priya").listPoints(H)), await data(demoQueries(changed, "priya").listPoints(H)), "a stored session rebuilds the same state");
  });

  it("parseDemoSession rejects malformed, foreign-version, expired and future sessions, and drops bad log entries", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    const s: DemoSession = { ...startDemoSession({ step: "review" }), startedAt: new Date(now - 60_000).toISOString() };
    assert.ok(parseDemoSession(serializeDemoSession(s), now));
    assert.equal(parseDemoSession("{not json", now), null);
    assert.equal(parseDemoSession(JSON.stringify({ ...s, version: DEMO_ENGINE_VERSION + 1 }), now), null);
    assert.equal(parseDemoSession(JSON.stringify({ ...s, step: "hack" }), now), null);
    assert.equal(parseDemoSession(JSON.stringify({ ...s, id: "x" }), now), null);
    assert.equal(parseDemoSession(JSON.stringify({ ...s, startedAt: new Date(now - DEMO_SESSION_MAX_AGE_MS - 1).toISOString() }), now), null);
    assert.equal(parseDemoSession(JSON.stringify({ ...s, startedAt: new Date(now + 3_600_000).toISOString() }), now), null);
    assert.equal(parseDemoSession("x".repeat(300_000), now), null);
    const withJunk = parseDemoSession(JSON.stringify({ ...s, log: [{ type: "deleteAccount" }, { type: "publish", input: { handoverId: H } }, { type: "inviteMember", input: { handoverId: H, email: "a@b.co", role: "incoming" } }] }), now)!;
    assert.deepEqual(withJunk.log, [{ type: "publish", input: { handoverId: H } }]);
  });
});
