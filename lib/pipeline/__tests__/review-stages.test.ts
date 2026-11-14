// analyze (D21 checklist → category gap questions) and prepare_review (§10.10). Synthetic data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PipelinePoint } from "../../db/pipeline";
import { EXPECTED_KNOWLEDGE_CHECKLIST, gapPriority } from "../checklist";
import { createMemoryLogger } from "../log";
import { runAnalyze, uncoveredChecklistItems } from "../stages/analyze";
import { pointsNeedingQuestions, questionForPoint, reviewOrder, runPrepareReview } from "../stages/prepare-review";
import type { StageContext } from "../stage-context";
import { claimed, fakeAi, fakeDb, fakeStorage, IDS, jobContext, rpcError } from "./fakes";

function point(over: Partial<PipelinePoint>): PipelinePoint {
  return {
    pointId: IDS.point1,
    category: "decision",
    origin: "extracted",
    extractionRunId: IDS.run,
    extractionAccessLevel: "everyone",
    accessLevel: "everyone",
    evidenceStatus: "sourced",
    reviewState: "pending",
    privacyReview: "none",
    currentRevisionId: IDS.point3,
    title: "Synthetic decision",
    statement: "Synthetic statement",
    attributes: {},
    redacted: false,
    newestEvidenceAt: null,
    lastSupportedAt: null,
    ...over,
  };
}

function stageCtx(stage: "analyze" | "prepare_review", db: ReturnType<typeof fakeDb>): StageContext {
  return {
    claimed: claimed(stage, 1, null),
    job: jobContext(stage),
    db: db.client,
    storage: fakeStorage(null).storage,
    logger: createMemoryLogger(),
    now: () => 0,
    deadlineAt: Number.POSITIVE_INFINITY,
    getPepper: () => ({ ok: false, error: { code: "processing_failed", message: "x", retryable: true } }),
    heartbeat: async () => {},
    ai: fakeAi().ai,
  };
}

describe("D21 checklist", () => {
  it("uses §10.10 priorities", () => {
    assert.equal(gapPriority("owner"), "required");
    assert.equal(gapPriority("account_access"), "required");
    assert.equal(gapPriority("open_task"), "required");
    assert.equal(gapPriority("blocker"), "required");
    assert.equal(gapPriority("contact"), "optional");
    assert.equal(gapPriority(null), "optional");
  });

  it("asks only for uncovered categories, and never twice", () => {
    const points = [point({ category: "account_access" }), point({ category: "owner", reviewState: "rejected" })];
    const first = uncoveredChecklistItems(points, []);
    assert.ok(!first.some((i) => i.category === "account_access"), "covered by a live point");
    assert.ok(first.some((i) => i.category === "owner"), "a rejected point does not cover");
    const asked = first.map((i) => ({ category: i.category, question: i.question, pointId: null }));
    assert.deepEqual(uncoveredChecklistItems(points, asked), []);
  });

  it("analyze creates category-level system questions at 'everyone' with no point", async () => {
    const db = fakeDb({ list_points_for_pipeline: [], list_gap_questions_for_pipeline: [], pipeline_create_system_gap_question: IDS.point2 });
    const out = await runAnalyze(stageCtx("analyze", db));
    assert.equal(out.kind, "succeeded");
    const created = db.called("pipeline_create_system_gap_question").map((c) => c.args);
    assert.equal(created.length, EXPECTED_KNOWLEDGE_CHECKLIST.length);
    for (const c of created) {
      assert.equal(c.p_point_id, null);
      assert.equal(c.p_access_level, "everyone");
      assert.equal(c.p_context, null);
      assert.ok(c.p_category);
    }
  });
});

describe("prepare_review (§10.10)", () => {
  it("orders conflicting, inferred, missing, sourced; newest evidence first", () => {
    const pts = [
      point({ pointId: "p-sourced", evidenceStatus: "sourced", newestEvidenceAt: "2026-01-05T00:00:00Z" }),
      point({ pointId: "p-missing", evidenceStatus: "missing" }),
      point({ pointId: "p-inferred-old", evidenceStatus: "inferred", newestEvidenceAt: "2026-01-01T00:00:00Z" }),
      point({ pointId: "p-inferred-new", evidenceStatus: "inferred", newestEvidenceAt: "2026-01-03T00:00:00Z" }),
      point({ pointId: "p-conflicting", evidenceStatus: "conflicting" }),
    ];
    assert.deepEqual(reviewOrder(pts).map((p) => p.pointId), ["p-conflicting", "p-inferred-new", "p-inferred-old", "p-missing", "p-sourced"]);
  });

  it("asks one question per missing point, never for held, rejected, redacted or already-asked points", () => {
    const pts = [
      point({ pointId: "a", evidenceStatus: "missing" }),
      point({ pointId: "b", evidenceStatus: "missing", privacyReview: "required" }),
      point({ pointId: "c", evidenceStatus: "missing", reviewState: "rejected" }),
      point({ pointId: "d", evidenceStatus: "missing", redacted: true, title: null }),
      point({ pointId: "e", evidenceStatus: "missing" }),
      point({ pointId: "f", evidenceStatus: "inferred" }),
    ];
    assert.deepEqual(pointsNeedingQuestions(pts, [{ pointId: "e" }]).map((p) => p.pointId), ["a"]);
  });

  it("caps the title in the question", () => {
    const q = questionForPoint("x".repeat(300));
    assert.ok(q.length < 200);
  });

  it("asks at the point's access level, sets sort keys, and skips a point held meanwhile", async () => {
    const pts = [
      point({ pointId: IDS.point1, evidenceStatus: "missing", accessLevel: "leads_only", category: "owner" }),
      point({ pointId: IDS.point2, evidenceStatus: "missing" }),
      point({ pointId: IDS.point3, evidenceStatus: "conflicting" }),
    ];
    const db = fakeDb({
      list_points_for_pipeline: pts,
      list_gap_questions_for_pipeline: [],
      pipeline_create_system_gap_question: (args: Record<string, unknown>) => (args.p_point_id === IDS.point2 ? rpcError("BTPF0") : "q"),
      pipeline_set_point_sort_keys: 3,
    });
    const out = await runPrepareReview(stageCtx("prepare_review", db));
    assert.equal(out.kind, "succeeded");
    const q = db.called("pipeline_create_system_gap_question").map((c) => c.args);
    assert.equal(q.length, 2);
    assert.equal(q[0].p_access_level, "leads_only");
    assert.equal(q[0].p_priority, "required");
    assert.equal(q[0].p_category, null);
    assert.equal(q[0].p_job_id, IDS.job, "DB-12: questions are written under the claim");
    assert.ok(!("p_handover_id" in q[0]), "the handover comes from the claim, never from the caller");
    const keys = db.called("pipeline_set_point_sort_keys")[0].args;
    assert.equal(keys.p_job_id, IDS.job, "DB-12: sort keys are written under the claim");
    assert.equal(keys.p_attempt, 1);
    assert.deepEqual((keys.p_keys as Array<{ pointId: string }>).map((k) => k.pointId), [IDS.point3, IDS.point1, IDS.point2]);
    assert.equal(db.called("approve_point").length, 0, "nothing is approved");
  });
});
