// R3 Task 03: the extract stage stores signals and chunk counts (EXT-1/2/3), the analyze stage stores
// review flags (VER-2/3). Fenced like every other write; a database without the migration still processes.
// Synthetic, pseudonymised data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyDropCounts, type ExtractDropReason } from "../../ai/extract";
import { ClaimLostError, type ExtractionMessage, type JobContext, type PipelinePoint } from "../../db/pipeline";
import type { CheckedCandidate, ExtractOutcome } from "../ai";
import { createMemoryLogger } from "../log";
import { buildReviewFlags } from "../review-flags";
import type { StageContext } from "../stage-context";
import { runAnalyze } from "../stages/analyze";
import { runExtract } from "../stages/extract";
import { attemptRecord, claimed, fakeAi, fakeChunkStore, fakeDb, fakeStorage, IDS, jobContext, provenance, rpcError } from "./fakes";

const M = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const msg = (n: number, body: string, author = "[PERSON_1]", conversation = "c_1"): ExtractionMessage => ({
  id: M(n),
  seq: n,
  conversationLocalId: conversation,
  authorLabel: author,
  sentAt: `2026-10-${String(n + 1).padStart(2, "0")}T10:00:00Z`,
  kind: "text",
  body,
});

function ctxFor(stage: JobContext["job"]["stage"], db: ReturnType<typeof fakeDb>, ai: ReturnType<typeof fakeAi>["ai"], job?: JobContext): StageContext {
  return {
    claimed: claimed(stage, 1, stage === "extract" ? IDS.source : null),
    job: job ?? jobContext(stage, { source: { state: "parsed" } }),
    db: db.client,
    storage: fakeStorage(null).storage,
    logger: createMemoryLogger(),
    now: () => 0,
    deadlineAt: Number.POSITIVE_INFINITY,
    getPepper: () => ({ ok: false, error: { code: "processing_failed", message: "x", retryable: true } }),
    heartbeat: async () => undefined,
    ai,
  };
}

function outcome(candidates: CheckedCandidate[], dropped: Partial<Record<ExtractDropReason, number>> = {}): { ok: true; data: ExtractOutcome } {
  return { ok: true, data: { candidates, dropped: { ...emptyDropCounts(), ...dropped }, provenance: provenance("extract"), attempt: attemptRecord() } };
}

function candidate(messageId: string, body: string, quote: string): CheckedCandidate {
  const start = body.indexOf(quote);
  return {
    category: "decision",
    title: "Venue decision",
    statement: "The team booked the main hall.",
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    citations: [{ messageId, quote, stance: "supports", quoteCheck: "exact", quoteStart: start, quoteEnd: start + quote.length, matchedText: quote }],
    inferenceRationale: null,
  } as CheckedCandidate;
}

function extractDb(messages: ExtractionMessage[], extra: Record<string, unknown> = {}) {
  const store = fakeChunkStore();
  const db = fakeDb({
    list_extraction_messages: (args: Record<string, unknown>) => ({
      accessLevel: "everyone",
      messages: messages.filter((m) => m.seq > (args.p_after_seq as number)).slice(0, args.p_limit as number),
    }),
    list_points_for_pipeline: [],
    pipeline_store_extract_chunk: store.handler,
    pipeline_set_job_provenance: null,
    pipeline_store_source_signals: (args: Record<string, unknown>) => (args.p_signals as unknown[]).length,
    pipeline_record_extract_chunk_stats: null,
    ...extra,
  });
  return Object.assign(db, { store });
}

const body0 = "We decided to book the main hall, pay ₹5,000 advance by Friday.";
const messages = [msg(0, body0), msg(1, "ok"), msg(2, "[PERSON_2] can you collect the keys tomorrow?")];

describe("extract: signals and coverage (EXT-1, EXT-2)", () => {
  it("scans every loaded message before the first AI call and stores coverage + signals under the claim", async () => {
    const db = extractDb(messages);
    let signalsBeforeAi = false;
    const { ai } = fakeAi({
      extract: () => {
        signalsBeforeAi = db.called("pipeline_store_source_signals").length === 1;
        return outcome([candidate(M(0), body0, "decided to book the main hall")], { fabricated: 2, unknown_message: 1 });
      },
    });
    const out = await runExtract(ctxFor("extract", db, ai));
    assert.equal(out.kind, "succeeded");
    assert.ok(signalsBeforeAi, "provider-independent discovery runs first");

    const call = db.called("pipeline_store_source_signals")[0].args;
    assert.equal(call.p_job_id, IDS.job, "DB-12: fenced");
    assert.equal(call.p_attempt, 1);
    const cov = call.p_coverage as Record<string, unknown>;
    assert.equal(cov.messagesInspected, 3);
    assert.equal(cov.messagesWithSignals, 2);
    assert.equal(cov.chunksTotal, 1);
    assert.equal(cov.detectorVersion, "signals@1");
    const signals = call.p_signals as Array<{ messageId: string; start: number; end: number; kind: string }>;
    assert.ok(signals.length > 0);
    for (const s of signals) {
      const m = messages.find((x) => x.id === s.messageId)!;
      assert.ok(s.end <= m.body.length, "offsets into the stored body");
    }
    assert.ok(!JSON.stringify(signals).includes("main hall"), "signals carry offsets, never a copy of the text");

    const stats = db.called("pipeline_record_extract_chunk_stats")[0].args;
    assert.equal(stats.p_chunk_index, 0);
    assert.deepEqual(stats.p_stats, {
      chunkTotal: 1,
      messages: 3,
      candidates: 3, // 1 kept + 2 fabricated (citation drops are not candidates)
      inserted: 1,
      merged: 0,
      dropped: { fabricated: 2, citations_unknown_message: 1 },
    });
  });

  it("does not rescan on resume (progress > 0) and records only new chunks", async () => {
    const db = extractDb([msg(0, body0, "[PERSON_1]", "c_1"), msg(1, "[PERSON_2] will send the invoice", "[PERSON_2]", "c_2")]);
    const job = jobContext("extract", { source: { state: "parsed" } });
    const resumed = { ...job, job: { ...job.job, progressDone: 1 } };
    db.store.handler({ p_chunk_index: 0, p_entries: [] }); // chunk 0 already committed
    const { ai } = fakeAi();
    const out = await runExtract(ctxFor("extract", db, ai, resumed));
    assert.equal(out.kind, "succeeded");
    assert.equal(db.called("pipeline_store_source_signals").length, 0);
    assert.deepEqual(db.called("pipeline_record_extract_chunk_stats").map((c) => c.args.p_chunk_index), [1]);
  });

  it("a database without the migration still processes; coverage is logged unavailable once", async () => {
    const db = extractDb(messages, { pipeline_store_source_signals: rpcError("PGRST202"), pipeline_record_extract_chunk_stats: rpcError("PGRST202") });
    const { ai } = fakeAi({ extract: () => outcome([candidate(M(0), body0, "decided to book the main hall")]) });
    const ctx = ctxFor("extract", db, ai);
    const out = await runExtract(ctx);
    assert.equal(out.kind, "succeeded");
    assert.equal(db.store.points.length, 1, "points are still stored");
    assert.equal(db.called("pipeline_record_extract_chunk_stats").length, 0, "no further attempts after the first refusal");
    const logs = (ctx.logger as unknown as { records: Array<{ event: string }> }).records;
    assert.equal(logs.filter((r) => r.event === "coverage_unavailable").length, 1, "logged once");
  });

  it("a lost claim on the signal write stops the job (fencing is never swallowed)", async () => {
    const db = extractDb(messages, { pipeline_store_source_signals: rpcError("BTLL0") });
    const { ai, calls } = fakeAi();
    await assert.rejects(runExtract(ctxFor("extract", db, ai)), (e: unknown) => e instanceof ClaimLostError);
    assert.equal(calls.extract.length, 0, "no AI call after a lost claim");
  });

  it("chunk boundary: the same claim extracted from two chunks is stored once (merged), and both chunks are counted", async () => {
    const b0 = "We decided to book the main hall for the fest.";
    const b1 = "Reminder: we decided to book the main hall for the fest.";
    const db = extractDb([msg(0, b0, "[PERSON_1]", "c_1"), msg(1, b1, "[PERSON_2]", "c_2")]);
    const { ai } = fakeAi({
      extract: (req) => outcome([candidate(req.messages[0].id, req.messages[0].body, "decided to book the main hall")]),
    });
    const out = await runExtract(ctxFor("extract", db, ai));
    assert.equal(out.kind, "succeeded");
    assert.equal(db.called("pipeline_store_extract_chunk").length, 2, "two chunks (two conversations)");
    assert.equal(db.store.points.length, 1, "one point, not a duplicate per chunk");
    assert.equal(db.store.evidence.length, 2, "the second chunk's citation is attached to the first point");
    const stats = db.called("pipeline_record_extract_chunk_stats").map((c) => c.args.p_stats as { inserted: number; merged: number });
    assert.deepEqual(stats.map((s) => [s.inserted, s.merged]), [[1, 0], [0, 1]]);
  });

  it("a failed chunk leaves earlier chunk stats and the checkpoint: the source is partial, not complete", async () => {
    const db = extractDb([msg(0, body0, "[PERSON_1]", "c_1"), msg(1, "[PERSON_2] will send the invoice by Monday", "[PERSON_2]", "c_2")]);
    const { ai } = fakeAi({
      extract: (_req, call) =>
        call === 0 ? outcome([]) : { ok: false, error: { code: "processing_failed", message: "x", retryable: true, details: { reason: "ai_provider_error" } } },
    });
    const out = await runExtract(ctxFor("extract", db, ai));
    assert.equal(out.kind, "failed");
    assert.deepEqual((out as { progress?: unknown }).progress, { done: 1, total: 2 });
    assert.deepEqual(db.called("pipeline_record_extract_chunk_stats").map((c) => c.args.p_chunk_index), [0]);
  });
});

function pipelinePoint(over: Partial<PipelinePoint>): PipelinePoint {
  return {
    pointId: IDS.point1,
    category: "owner",
    origin: "extracted",
    extractionRunId: IDS.run,
    extractionAccessLevel: "everyone",
    accessLevel: "everyone",
    evidenceStatus: "sourced",
    reviewState: "pending",
    privacyReview: "none",
    currentRevisionId: IDS.point3,
    title: "Sponsor money owner",
    statement: "Kabir handles the sponsor money of ₹20,000.",
    attributes: { responsibility: "Sponsor money", ownerLabel: "Kabir", since: null },
    redacted: false,
    newestEvidenceAt: null,
    lastSupportedAt: null,
    citedMessageIds: [M(0)],
    originalStatement: "Kabir handles the sponsor money of ₹20,000.",
    ...over,
  };
}

describe("analyze: review flags (VER-2, VER-3)", () => {
  const msgs = [
    { id: M(0), sourceId: IDS.source, seq: 0, sentAt: "2026-10-01T10:00:00Z", authorLabel: "[PERSON_1]", body: "[PERSON_1] is in charge of the sponsor money, ₹20,000" },
    { id: M(1), sourceId: IDS.source, seq: 1, sentAt: "2026-10-05T10:00:00Z", authorLabel: "[PERSON_2]", body: "Actually the sponsor money is now ₹15,000 and [PERSON_2] takes over" },
  ];

  it("flags a later reversal and an unrecognised owner, never touching status", () => {
    const flags = buildReviewFlags([pipelinePoint({})], msgs);
    const contradiction = flags.find((f) => f.kind === "possible_contradiction")!;
    assert.equal(contradiction.messageId, M(1));
    assert.equal(contradiction.revisionId, IDS.point3, "flags are scoped to the current revision");
    assert.ok((contradiction.detail.reasons as string[]).includes("changed_amount"));
    const attribution = flags.find((f) => f.kind === "attribution_unresolved")!;
    assert.deepEqual(attribution.detail, { field: "ownerLabel", status: "unrecognized" });
    assert.ok(flags.every((f) => !("evidenceStatus" in f)));
  });

  it("skips reviewed, rejected, redacted and human-edited points for attribution", () => {
    assert.deepEqual(buildReviewFlags([pipelinePoint({ reviewState: "approved" })], msgs), []);
    assert.deepEqual(buildReviewFlags([pipelinePoint({ redacted: true, statement: null })], msgs), []);
    const edited = buildReviewFlags([pipelinePoint({ statement: "Edited by a reviewer: Kabir handles the sponsor money of ₹20,000." })], msgs);
    assert.ok(edited.every((f) => f.kind !== "attribution_unresolved"));
  });

  it("the analyze job stores flags under its claim after the checklist questions", async () => {
    const db = fakeDb({
      list_points_for_pipeline: [pipelinePoint({})],
      list_gap_questions_for_pipeline: [],
      list_extraction_messages: (args: Record<string, unknown>) => ({
        accessLevel: "everyone",
        messages: (args.p_after_seq as number) < 0 ? msgs.map((m) => ({ ...m, conversationLocalId: "c_1", kind: "text" })) : [],
      }),
      pipeline_store_point_flags: (args: Record<string, unknown>) => (args.p_flags as unknown[]).length,
    });
    const job = jobContext("analyze");
    const out = await runAnalyze(ctxFor("analyze", db, fakeAi().ai, { ...job, run: { ...job.run, sourceIds: [IDS.source] } }));
    assert.equal(out.kind, "succeeded");
    const call = db.called("pipeline_store_point_flags")[0].args;
    assert.equal(call.p_job_id, IDS.job);
    assert.equal((call.p_flags as unknown[]).length, 2);
  });

  it("analyze still succeeds on a database without the migration", async () => {
    const db = fakeDb({
      list_points_for_pipeline: [pipelinePoint({})],
      list_gap_questions_for_pipeline: [],
      list_extraction_messages: (args: Record<string, unknown>) => ({ accessLevel: "everyone", messages: (args.p_after_seq as number) < 0 ? msgs : [] }),
      pipeline_store_point_flags: rpcError("42883"),
    });
    const job = jobContext("analyze");
    const out = await runAnalyze(ctxFor("analyze", db, fakeAi().ai, { ...job, run: { ...job.run, sourceIds: [IDS.source] } }));
    assert.equal(out.kind, "succeeded");
  });
});
