import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { linkLevelAtLeast, questionLevelAtLeast } from "../../../components/gaps/gap-access";
import { createGapInterviewLink, createGapQuestion, reviewGapAnswer, reviewPoint, submitGapAnswers } from "../actions";
import { CODECELL_ID } from "../fixtures/codecell";
import { PROFILES } from "../fixtures/profiles";
import { gapQuestionAccessLevel } from "../derive";
import { createMockQueries } from "../queries";
import { getStore } from "../store";
import { expectError, expectOk, resetStore } from "./helpers";

/** An open, point-linked CodeCell question whose point is currently "everyone". */
function everyoneQuestion() {
  const store = getStore();
  const q = store.gapQuestions.find((x) => {
    if (x.handoverId !== CODECELL_ID || x.status !== "open" || !x.pointId) return false;
    const p = store.points.find((pt) => pt.id === x.pointId)!;
    return gapQuestionAccessLevel(store, x) === "everyone" && p.privacyReview !== "required";
  });
  assert.ok(q, "fixture has an open everyone-level question linked to a point");
  return { q, point: store.points.find((p) => p.id === q.pointId)! };
}

describe("gap-question access level (§6.15, §8.4)", () => {
  beforeEach(() => resetStore());

  it("is the stricter of the requested level and the point's level at creation", async () => {
    const { point } = everyoneQuestion();
    point.accessOverride = "leads_only";
    const q = expectOk(await createGapQuestion({ handoverId: CODECELL_ID, pointId: point.id, question: "Who holds the key?", priority: "optional", accessLevel: "everyone" }));
    const stored = getStore().gapQuestions.find((x) => x.id === q.id)!;
    assert.equal(gapQuestionAccessLevel(getStore(), stored), "leads_only");
    // A higher requested level is kept.
    const q2 = expectOk(await createGapQuestion({ handoverId: CODECELL_ID, pointId: point.id, question: "And the backup?", priority: "optional", accessLevel: "reviewer_only" }));
    assert.equal(gapQuestionAccessLevel(getStore(), getStore().gapQuestions.find((x) => x.id === q2.id)!), "reviewer_only");
  });

  it("follows a later change_access on the linked point (the trigger on point access change)", async () => {
    const { q, point } = everyoneQuestion();
    // Neha (incoming, clearance everyone) sees open questions at her clearance in the mock.
    const before = expectOk(await createMockQueries(PROFILES.neha.id).listGapQuestions(CODECELL_ID));
    assert.ok(before.some((x) => x.id === q.id), "visible before the point was restricted");
    expectOk(await reviewPoint({ action: "change_access", pointId: point.id, accessOverride: "leads_only" }));
    assert.equal(gapQuestionAccessLevel(getStore(), q), "leads_only");
    const after = expectOk(await createMockQueries(PROFILES.neha.id).listGapQuestions(CODECELL_ID));
    assert.equal(after.some((x) => x.id === q.id), false, "hidden from an everyone-clearance member");
    // A link at "everyone" can no longer include it; at leads_only it can.
    const err = expectError(await createGapInterviewLink({ handoverId: CODECELL_ID, questionIds: [q.id], maxAccessLevel: "everyone" }), "validation_failed");
    assert.ok(err.fieldErrors?.maxAccessLevel);
    expectOk(await createGapInterviewLink({ handoverId: CODECELL_ID, questionIds: [q.id], maxAccessLevel: "leads_only" }));
  });

  it("drops a raised question from an existing everyone-level link and refuses answers to it", async () => {
    const { q, point } = everyoneQuestion();
    const link = expectOk(await createGapInterviewLink({ handoverId: CODECELL_ID, questionIds: [q.id], maxAccessLevel: "everyone" }));
    const token = decodeURIComponent(link.url.split("/").pop()!);
    assert.deepEqual(expectOk(await createMockQueries(PROFILES.priya.id).getGapInterview(token)).questions.map((x) => x.id), [q.id]);
    expectOk(await reviewPoint({ action: "change_access", pointId: point.id, accessOverride: "leads_only" }));
    assert.deepEqual(expectOk(await createMockQueries(PROFILES.priya.id).getGapInterview(token)).questions, []);
    expectError(await submitGapAnswers({ token, answererLabel: "Someone", answers: [{ gapQuestionId: q.id, answerText: "It's in the drawer." }] }), "not_found");
  });

  it("gives accepted testimony the question's effective level", async () => {
    const { q, point } = everyoneQuestion();
    expectOk(await submitGapAnswers({ answers: [{ gapQuestionId: q.id, answerText: "The faculty office has it." }] }));
    expectOk(await reviewPoint({ action: "change_access", pointId: point.id, accessOverride: "leads_only" }));
    const answer = getStore().gapQuestions.find((x) => x.id === q.id)!.answers.at(-1)!;
    expectOk(await reviewGapAnswer({ answerId: answer.id, decision: "accept" }));
    const testimony = point.links.find((l) => l.kind === "testimony" && l.quote === answer.text)!;
    assert.equal(testimony.accessLevel, "leads_only");
  });
});

describe("what the UI can derive (components/gaps/gap-access.ts)", () => {
  const points = new Map([
    ["p-everyone", { accessLevel: "everyone" as const }],
    ["p-leads", { accessLevel: "leads_only" as const }],
  ]);

  it("derives a minimum only from a linked, visible point", () => {
    assert.equal(questionLevelAtLeast({ pointId: "p-leads" }, points), "leads_only");
    assert.equal(questionLevelAtLeast({ pointId: "p-everyone" }, points), "everyone");
    assert.equal(questionLevelAtLeast({ pointId: null }, points), null, "never assumes everyone");
    assert.equal(questionLevelAtLeast({ pointId: "p-hidden" }, points), null);
  });

  it("reports the strictest derivable level and how many questions it can't see", () => {
    assert.deepEqual(linkLevelAtLeast([{ pointId: "p-everyone" }, { pointId: "p-leads" }, { pointId: null }], points), { atLeast: "leads_only", underivable: 1 });
    assert.deepEqual(linkLevelAtLeast([{ pointId: null }, { pointId: null }], points), { atLeast: "everyone", underivable: 2 });
  });
});
