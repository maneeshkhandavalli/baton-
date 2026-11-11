// extract, verify_quotes and verify_support against the amended I1 signatures, with the real fake adapter
// as provider and scripted extractCandidates / verifySupport, to drive stage edge cases precisely. The real
// A2 functions run in e2e-ai.test.ts. Synthetic data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aiConfigChangedError, providerNotConfiguredError } from "../../ai/errors";
import { emptyDropCounts, EXTRACT_REQUEST_LIMITS, type ExtractDropReason } from "../../ai/extract";
import type { ExtractionMessage, JobContext, LinkNeedingSupport, PipelinePoint } from "../../db/pipeline";
import type { CheckedCandidate, ExtractOutcome } from "../ai";
import { planChunks } from "../chunk";
import { normalizeClaimText, PointIndex } from "../dedup";
import { createMemoryLogger } from "../log";
import type { StageContext } from "../stage-context";
import { EXTRACT_YIELD_MARGIN_MS, runExtract } from "../stages/extract";
import { authoritativeCheck, runVerifyQuotes } from "../stages/verify-quotes";
import { buildVerifyRequest, runVerifySupport, VERIFY_CALLS_PER_RUN } from "../stages/verify-support";
import { attemptRecord, claimed, fakeAi, fakeDb, fakeStorage, IDS, jobContext, provenance, rpcError, RUN_CONFIG } from "./fakes";

const M = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function msg(n: number, body: string, conversation: string | null = "c_1", authorLabel: string | null = "Participant 1"): ExtractionMessage {
  return { id: M(n), seq: n, conversationLocalId: conversation, authorLabel, sentAt: null, kind: "text", body };
}

function point(over: Partial<PipelinePoint>): PipelinePoint {
  return {
    pointId: IDS.point1,
    category: "owner",
    origin: "extracted",
    extractionRunId: IDS.run,
    extractionAccessLevel: "everyone",
    accessLevel: "everyone",
    evidenceStatus: "inferred",
    reviewState: "pending",
    privacyReview: "none",
    currentRevisionId: IDS.point3,
    title: "Treasurer owns reimbursements",
    statement: "The treasurer handles reimbursements.",
    attributes: { responsibility: "Reimbursements", ownerLabel: null, since: null },
    redacted: false,
    newestEvidenceAt: null,
    lastSupportedAt: null,
    ...over,
  };
}

function ctxFor(
  stage: JobContext["job"]["stage"],
  db: ReturnType<typeof fakeDb>,
  ai: ReturnType<typeof fakeAi>["ai"],
  over: { job?: JobContext; now?: () => number; deadlineAt?: number; heartbeats?: unknown[] } = {},
): StageContext {
  return {
    claimed: claimed(stage, 1, stage === "verify_support" ? null : IDS.source),
    job: over.job ?? jobContext(stage, { source: { state: "parsed" } }),
    db: db.client,
    storage: fakeStorage(null).storage,
    logger: createMemoryLogger(),
    now: over.now ?? (() => 0),
    deadlineAt: over.deadlineAt ?? Number.POSITIVE_INFINITY,
    getPepper: () => ({ ok: false, error: { code: "processing_failed", message: "x", retryable: true } }),
    heartbeat: async (p) => void over.heartbeats?.push(p),
    ai,
  };
}

function withProgress(job: JobContext, progressDone: number, sourceCount = 1): JobContext {
  return {
    ...job,
    job: { ...job.job, progressDone },
    run: { ...job.run, sourceIds: Array.from({ length: sourceCount }, (_, i) => M(900 + i)) },
  };
}

function outcome(candidates: CheckedCandidate[], dropped: Partial<Record<ExtractDropReason, number>> = {}): { ok: true; data: ExtractOutcome } {
  return { ok: true, data: { candidates, dropped: { ...emptyDropCounts(), ...dropped }, provenance: provenance("extract"), attempt: attemptRecord() } };
}

function ownerCandidate(statement: string, citations: CheckedCandidate["citations"], responsibility = "Reimbursements"): CheckedCandidate {
  return {
    category: "owner",
    title: "Owner of reimbursements",
    statement,
    attributes: { responsibility, ownerLabel: null, since: null },
    citations,
    inferenceRationale: null,
  } as CheckedCandidate;
}

/** A DB fake for the extract stage over the given message pages. */
function extractDb(messages: ExtractionMessage[], opts: { points?: PipelinePoint[]; levels?: string[]; evidence?: (args: Record<string, unknown>) => unknown } = {}) {
  let pageIndex = 0;
  let pointSeq = 0;
  return fakeDb({
    list_extraction_messages: (args: Record<string, unknown>) => {
      const level = opts.levels?.[pageIndex] ?? "leads_only";
      pageIndex += 1;
      return { accessLevel: level, messages: messages.filter((m) => m.seq > (args.p_after_seq as number)).slice(0, args.p_limit as number) };
    },
    list_points_for_pipeline: opts.points ?? [],
    insert_extracted_point: () => M(500 + ++pointSeq),
    add_source_quote_evidence: opts.evidence ?? (() => M(700)),
    set_job_provenance: null,
  });
}

describe("chunking (§10.6, §12.10 rule 4)", () => {
  const H = { teamName: "Team", roleTitle: null };

  it("never spans conversations, respects message and character limits, skips oversize and empty", () => {
    const messages = [
      msg(0, "a".repeat(10)),
      msg(1, "b".repeat(10)),
      msg(2, "c".repeat(10), "c_2"),
      msg(3, "   "),
      msg(4, "d".repeat(100), "c_2"),
      msg(5, "e".repeat(10), "c_2"),
      msg(6, "f".repeat(10), "c_2"),
    ];
    const plan = planChunks(messages, H, { maxMessages: 2, maxChars: 4 + 13 + 40 });
    assert.deepEqual(plan.chunks.map((c) => c.map((m) => m.seq)), [[0, 1], [2, 5], [6]]);
    assert.equal(plan.skippedOversize, 1);
    assert.equal(plan.skippedEmpty, 1);
  });

  it("counts the team name, role title and author labels against the character limit", () => {
    const plan = planChunks([msg(0, "x".repeat(10), "c_1", "L".repeat(5)), msg(1, "y".repeat(10), "c_1", "L".repeat(5))], { teamName: "T".repeat(10), roleTitle: "R".repeat(10) }, { maxMessages: 10, maxChars: 40 });
    assert.deepEqual(plan.chunks.map((c) => c.length), [1, 1]);
  });

  it("uses lib/ai's request limits by default and is deterministic", () => {
    const many = Array.from({ length: 450 }, (_, i) => msg(i, `message number ${i} with synthetic text`));
    const a = planChunks(many, H, EXTRACT_REQUEST_LIMITS);
    const b = planChunks(many, H, EXTRACT_REQUEST_LIMITS);
    assert.deepEqual(a.chunks.map((c) => c.length), [200, 200, 50]);
    assert.deepEqual(a, b);
  });
});

describe("dedup (W0 I2.3)", () => {
  it("matches statements ignoring case, punctuation and spacing", () => {
    assert.equal(normalizeClaimText("  The Treasurer, handles reimbursements!! "), "the treasurer handles reimbursements");
    const idx = new PointIndex([point({})], "everyone");
    assert.equal(idx.find({ category: "owner", statement: "the treasurer HANDLES reimbursements", attributes: null }), IDS.point1);
    assert.equal(idx.find({ category: "decision", statement: "The treasurer handles reimbursements.", attributes: null }), null);
  });

  it("matches the same subject (conflict candidates attach for independent verification)", () => {
    const idx = new PointIndex([point({})], "everyone");
    assert.equal(idx.find({ category: "owner", statement: "Someone else handles reimbursements now", attributes: { responsibility: "reimbursements" } }), IDS.point1);
  });

  it("never merges across access levels, into held, redacted or non-extracted points; rejected points stay targets", () => {
    const c = { category: "owner" as const, statement: "The treasurer handles reimbursements.", attributes: null };
    assert.equal(new PointIndex([point({})], "leads_only").find(c), null);
    assert.equal(new PointIndex([point({ privacyReview: "required" })], "everyone").find(c), null);
    assert.equal(new PointIndex([point({ redacted: true, statement: null, title: null })], "everyone").find(c), null);
    assert.equal(new PointIndex([point({ origin: "manual", extractionAccessLevel: null })], "everyone").find(c), null);
    assert.equal(new PointIndex([point({ reviewState: "rejected" })], "everyone").find(c), IDS.point1);
  });
});

describe("extract stage", () => {
  const body0 = "The treasurer handles reimbursements every Friday.";
  const messages = [msg(0, body0), msg(1, "Another synthetic message in the same chat.")];

  it("stores new points at the source's level with quotes pending (matchedText + offsets, or the model quote)", async () => {
    const db = extractDb(messages);
    const exact = { messageId: M(0), quote: "treasurer handles reimbursements", stance: "supports" as const, quoteCheck: "normalized" as const, quoteStart: 4, quoteEnd: 36, matchedText: body0.slice(4, 36) };
    const missing = { messageId: M(1), quote: "a quote that does not exist", stance: "contradicts" as const, quoteCheck: "not_found" as const, quoteStart: null, quoteEnd: null, matchedText: null };
    const { ai, calls } = fakeAi({ extract: () => outcome([ownerCandidate("The treasurer handles reimbursements.", [exact, missing])], { schema_invalid: 2 }) });
    const heartbeats: unknown[] = [];
    const out = await runExtract(ctxFor("extract", db, ai, { heartbeats }));

    assert.equal(out.kind, "succeeded");
    assert.deepEqual(heartbeats, [{ done: 1, total: 1 }]);
    const ins = db.called("insert_extracted_point")[0].args;
    assert.equal(ins.p_extraction_access_level, "leads_only", "QA-M8: the source's level");
    assert.equal(ins.p_run_id, IDS.run);
    assert.deepEqual(ins.p_ai_provenance, provenance("extract"));
    const ev = db.called("add_source_quote_evidence").map((c) => c.args);
    assert.deepEqual(ev[0], { p_point_id: M(501), p_source_message_id: M(0), p_quote_text: body0.slice(4, 36), p_quote_start: 4, p_quote_end: 36, p_quote_check: "pending" });
    assert.deepEqual(ev[1], { p_point_id: M(501), p_source_message_id: M(1), p_quote_text: "a quote that does not exist", p_quote_start: null, p_quote_end: null, p_quote_check: "pending" });

    // the request: this source's messages only, all categories, no file names or titles
    assert.equal(calls.extract.length, 1);
    assert.deepEqual(calls.extract[0].messages.map((m) => m.id), [M(0), M(1)]);
    assert.equal(calls.extract[0].categories.length, 10);
    assert.ok(!JSON.stringify(calls.extract[0]).includes("chat.txt"));
    assert.deepEqual(calls.providerForRun[0], RUN_CONFIG, "the run snapshot, not live config");
  });

  it("writes provenance before calling the provider (§11.8 rule 3)", async () => {
    const db = extractDb(messages);
    let provenanceWrittenFirst = false;
    const { ai } = fakeAi({
      extract: () => {
        provenanceWrittenFirst = db.called("set_job_provenance").length === 1;
        return outcome([]);
      },
    });
    await runExtract(ctxFor("extract", db, ai));
    assert.ok(provenanceWrittenFirst);
    const p = db.called("set_job_provenance")[0].args.p_provenance as Record<string, unknown>;
    assert.equal(p.model, null);
    assert.equal(p.requestedModel, RUN_CONFIG.extract.model);
  });

  it("attaches duplicates and same-subject candidates to the existing point instead of inserting", async () => {
    const db = extractDb(messages, { points: [point({ extractionAccessLevel: "leads_only" })] });
    const cit = { messageId: M(0), quote: "x", stance: "supports" as const, quoteCheck: "exact" as const, quoteStart: 0, quoteEnd: 12, matchedText: body0.slice(0, 12) };
    const { ai } = fakeAi({
      extract: () =>
        outcome([
          ownerCandidate("THE TREASURER handles reimbursements", [cit]),
          ownerCandidate("Ravi handles reimbursements from now on", [cit], "reimbursements"),
          ownerCandidate("The treasurer handles reimbursements.", []),
        ]),
    });
    await runExtract(ctxFor("extract", db, ai));
    assert.equal(db.called("insert_extracted_point").length, 0);
    const ev = db.called("add_source_quote_evidence").map((c) => c.args.p_point_id);
    assert.deepEqual(ev, [IDS.point1, IDS.point1]);
  });

  it("dedups within the run too: a later identical candidate attaches to the point just inserted", async () => {
    const db = extractDb(messages);
    const cit = { messageId: M(0), quote: "x", stance: "supports" as const, quoteCheck: "exact" as const, quoteStart: 0, quoteEnd: 12, matchedText: body0.slice(0, 12) };
    const { ai } = fakeAi({ extract: () => outcome([ownerCandidate("A claim", [cit]), ownerCandidate("a claim!", [cit], "other")]) });
    await runExtract(ctxFor("extract", db, ai));
    assert.equal(db.called("insert_extracted_point").length, 1);
    assert.equal(db.called("add_source_quote_evidence").length, 2);
  });

  it("drops a citation the database refuses or whose message is gone, keeps going", async () => {
    let n = 0;
    const db = extractDb(messages, { evidence: () => (n++ === 0 ? rpcError("BTNF0") : M(700)) });
    const cit = { messageId: M(0), quote: "x", stance: "supports" as const, quoteCheck: "exact" as const, quoteStart: 0, quoteEnd: 12, matchedText: body0.slice(0, 12) };
    const { ai } = fakeAi({ extract: () => outcome([ownerCandidate("Claim one", [cit, { ...cit, messageId: M(1) }])]) });
    const out = await runExtract(ctxFor("extract", db, ai));
    assert.equal(out.kind, "succeeded");
    assert.equal(db.called("add_source_quote_evidence").length, 2);
  });

  it("ignores citations to messages outside the chunk (defence in depth)", async () => {
    const db = extractDb(messages);
    const foreign = { messageId: M(99), quote: "x", stance: "supports" as const, quoteCheck: "exact" as const, quoteStart: 0, quoteEnd: 12, matchedText: "x".repeat(12) };
    const { ai } = fakeAi({ extract: () => outcome([ownerCandidate("Claim", [foreign])]) });
    await runExtract(ctxFor("extract", db, ai));
    assert.equal(db.called("add_source_quote_evidence").length, 0);
  });

  it("fails the run without calling the AI when the provider is not configured or the config changed", async () => {
    for (const error of [providerNotConfiguredError(), aiConfigChangedError()]) {
      const db = extractDb(messages);
      const { ai, calls } = fakeAi({ provider: { ok: false, error } });
      const out = await runExtract(ctxFor("extract", db, ai));
      assert.equal(out.kind, "failed");
      if (out.kind === "failed") {
        assert.equal(out.failure.retryable, false);
        assert.equal(out.failure.code, "precondition_failed");
        assert.equal(out.failure.reason, error.details?.reason);
      }
      assert.equal(calls.extract.length, 0);
      assert.equal(db.called("set_job_provenance").length, 0);
    }
  });

  it("refuses a run snapshot that is not a valid AiRunConfig", async () => {
    const job = jobContext("extract", { source: { state: "parsed" } });
    const bad = { ...job, run: { ...job.run, aiConfig: { provider: "fake" } } };
    const { ai } = fakeAi();
    const out = await runExtract(ctxFor("extract", extractDb(messages), ai, { job: bad }));
    assert.ok(out.kind === "failed" && out.failure.reason === "ai_config_changed");
  });

  it("checkpoints: a retryable AI failure keeps progress, and a retry resumes at the next chunk", async () => {
    const many = Array.from({ length: 450 }, (_, i) => msg(i, `synthetic message ${i}`));
    const db1 = extractDb(many);
    const { ai: ai1 } = fakeAi({
      extract: (_r, call) =>
        call === 0 ? outcome([]) : { ok: false, error: { code: "processing_failed", message: "x", retryable: true, details: { reason: "ai_timed_out" } }, attempt: attemptRecord(1) },
    });
    const out = await runExtract(ctxFor("extract", db1, ai1));
    assert.equal(out.kind, "failed");
    if (out.kind === "failed") {
      assert.deepEqual(out.progress, { done: 1, total: 3 });
      assert.equal(out.failure.reason, "ai_timed_out");
      assert.equal(out.failure.retryable, true);
      assert.ok(out.attemptRecord);
    }

    const { ai: ai2, calls } = fakeAi();
    const resumed = await runExtract(ctxFor("extract", extractDb(many), ai2, { job: withProgress(jobContext("extract", { source: { state: "parsed" } }), 1) }));
    assert.equal(resumed.kind, "succeeded");
    assert.equal(calls.extract.length, 2);
    assert.equal(calls.extract[0].messages[0].id, M(200));
  });

  it("yields near the deadline after finishing at least one chunk", async () => {
    const many = Array.from({ length: 450 }, (_, i) => msg(i, `synthetic message ${i}`));
    let t = 0;
    const { ai, calls } = fakeAi({ extract: () => ((t = 1_000_000), outcome([])) });
    const out = await runExtract(ctxFor("extract", extractDb(many), ai, { now: () => t, deadlineAt: 1_000_000 + EXTRACT_YIELD_MARGIN_MS - 1 }));
    assert.deepEqual(out, { kind: "yield", progress: { done: 1, total: 3 } });
    assert.equal(calls.extract.length, 1);
  });

  it("enforces the per-run extract budget before any call", async () => {
    const { ai, calls } = fakeAi();
    const out = await runExtract(
      ctxFor("extract", extractDb(messages), ai, { job: withProgress(jobContext("extract", { source: { state: "parsed" } }), 0, 201) }),
    );
    assert.ok(out.kind === "failed" && out.failure.reason === "ai_budget_exceeded" && !out.failure.retryable);
    assert.equal(calls.extract.length, 0);
  });

  it("retries when the source's access level changes while reading", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => msg(i, `m${i}`));
    const { ai, calls } = fakeAi();
    const out = await runExtract(ctxFor("extract", extractDb(many, { levels: ["everyone", "leads_only"] }), ai));
    assert.ok(out.kind === "failed" && out.failure.reason === "source_changed" && out.failure.retryable);
    assert.equal(calls.extract.length, 0);
  });
});

describe("verify_quotes stage (§10.7)", () => {
  const body = "Venue deposit is due on Friday – please pay";

  it("decides against the persisted body and the stored offsets", () => {
    const q = (o: Partial<Parameters<typeof authoritativeCheck>[0]>) => authoritativeCheck({ quoteText: "deposit is due on Friday", quoteStart: 6, quoteEnd: 30, messageBody: body, ...o });
    assert.equal(q({}), "exact");
    assert.equal(q({ messageBody: null }), null, "pruned: unchanged");
    assert.equal(q({ quoteStart: null, quoteEnd: null }), "not_found");
    assert.equal(q({ quoteStart: 5, quoteEnd: 29 }), "not_found", "offsets that do not slice the text");
    assert.equal(q({ quoteText: "due on", quoteStart: 17, quoteEnd: 23 }), "not_found", "below the §10.7.4 minimum");
    assert.equal(q({ quoteText: "on Friday - please pay", quoteStart: 21, quoteEnd: 43 }), "normalized");
  });

  it("records every check and fails closed when the database refuses one", async () => {
    const db = fakeDb({
      list_quotes_for_check: [
        { evidenceId: M(1), sourceMessageId: M(10), quoteText: "deposit is due on Friday", quoteStart: 6, quoteEnd: 30, quoteCheck: "pending", messageBody: body },
        { evidenceId: M(2), sourceMessageId: M(10), quoteText: "never said this at all", quoteStart: null, quoteEnd: null, quoteCheck: "pending", messageBody: body },
        { evidenceId: M(3), sourceMessageId: null, quoteText: "pruned message quote", quoteStart: 0, quoteEnd: 20, quoteCheck: "pending", messageBody: null },
      ],
      record_quote_check: (args: Record<string, unknown>) => (args.p_evidence_id === M(1) && args.p_quote_check === "exact" ? rpcError("BTVF0") : null),
    });
    const out = await runVerifyQuotes(ctxFor("verify_quotes", db, fakeAi().ai));
    assert.equal(out.kind, "succeeded");
    assert.deepEqual(
      db.called("record_quote_check").map((c) => [c.args.p_evidence_id, c.args.p_quote_check]),
      [[M(1), "exact"], [M(1), "not_found"], [M(2), "not_found"]],
    );
  });
});

describe("verify_support stage (§10.8, D16)", () => {
  function link(n: number, over: Partial<LinkNeedingSupport> = {}): LinkNeedingSupport {
    return {
      pointEvidenceId: M(n),
      pointId: IDS.point1,
      revisionId: IDS.point3,
      claim: { category: "owner", title: "Owner", statement: "The treasurer handles reimbursements.", attributes: { responsibility: "Reimbursements" } },
      evidenceKind: "source_quote",
      quote: { text: `synthetic quote ${n}`, authorLabel: "Participant 1", sentAt: null },
      context: [1, 2, 3, 4].map((i) => ({ authorLabel: null, sentAt: null, body: `neighbour ${i}` })),
      ...over,
    };
  }

  /** Links stay listed until a verdict is recorded for them. */
  function supportDb(links: LinkNeedingSupport[], record?: (args: Record<string, unknown>) => unknown) {
    const verified = new Set<string>();
    return fakeDb({
      list_links_needing_support: (args: Record<string, unknown>) => links.filter((l) => !verified.has(l.pointEvidenceId)).slice(0, args.p_limit as number),
      record_support_verdict: (args: Record<string, unknown>) => {
        const r = record?.(args);
        if (!r) verified.add(args.p_point_evidence_id as string);
        return r ?? null;
      },
      set_job_provenance: null,
    });
  }

  it("records verdicts for the current revision with the text the verifier saw; the request never carries a stance", async () => {
    const db = supportDb([link(1), link(2, { evidenceKind: "testimony", context: [] })]);
    const { ai, calls } = fakeAi({
      verify: (_r, i) => ({ ok: true, data: { verdict: i === 0 ? "contradicts" : "partial", rationale: i === 0 ? "Synthetic rationale." : null, provenance: provenance("verify"), attempt: attemptRecord() } }),
    });
    const out = await runVerifySupport(ctxFor("verify_support", db, ai));
    assert.deepEqual(out, { kind: "succeeded", progress: { done: 2, total: 2 }, attemptRecord: attemptRecord() });
    const rec = db.called("record_support_verdict").map((c) => c.args);
    assert.equal(rec.length, 2);
    assert.equal(rec[0].p_verdict, "contradicts");
    assert.equal(rec[0].p_revision_id, IDS.point3);
    assert.equal(rec[1].p_rationale, null);
    assert.match(String(rec[0].p_quote_sha256), /^\\x[0-9a-f]{64}$/);
    for (const req of calls.verify) {
      assert.deepEqual(Object.keys(req).sort(), ["claim", "context", "quote"]);
      assert.ok(!JSON.stringify(req).includes("stance"));
      assert.ok(req.context.length <= 3);
    }
  });

  it("does not resolve a provider when nothing needs verification", async () => {
    const { ai, calls } = fakeAi({ provider: { ok: false, error: providerNotConfiguredError() } });
    const out = await runVerifySupport(ctxFor("verify_support", supportDb([]), ai));
    assert.equal(out.kind, "succeeded");
    assert.equal(calls.providerForRun.length, 0);
  });

  it("discards a verdict whose evidence changed meanwhile and does not loop on it", async () => {
    const db = supportDb([link(1)], () => rpcError("BTCF0"));
    const { ai, calls } = fakeAi();
    const out = await runVerifySupport(ctxFor("verify_support", db, ai));
    assert.equal(out.kind, "succeeded");
    assert.equal(calls.verify.length, 1);
  });

  it("trims context to fit and leaves a pair that cannot fit unchecked", async () => {
    const big = "w".repeat(5_000);
    const trimmed = buildVerifyRequest(link(1, { context: [big, big, big].map((b) => ({ authorLabel: null, sentAt: null, body: b })) }));
    assert.equal(trimmed?.context.length, 2, "3 × 5,000 exceeds 12,000; 2 fit");
    assert.equal(buildVerifyRequest(link(2, { quote: { text: "q".repeat(20_000), authorLabel: null, sentAt: null } })), null);

    const db = supportDb([link(2, { quote: { text: "q".repeat(20_000), authorLabel: null, sentAt: null } })]);
    const { ai, calls } = fakeAi();
    assert.equal((await runVerifySupport(ctxFor("verify_support", db, ai))).kind, "succeeded");
    assert.equal(calls.verify.length, 0);
    assert.equal(db.called("record_support_verdict").length, 0);
  });

  it("an AI failure fails the job with the calls made so far as progress", async () => {
    const db = supportDb([link(1), link(2)]);
    const { ai } = fakeAi({ verify: (_r, i) => (i === 0 ? { ok: true, data: { verdict: "supports", rationale: null, provenance: provenance("verify"), attempt: attemptRecord() } } : { ok: false, error: { code: "processing_failed", message: "x", retryable: false, details: { reason: "ai_invalid_output" } } }) });
    const out = await runVerifySupport(ctxFor("verify_support", db, ai));
    assert.ok(out.kind === "failed");
    if (out.kind === "failed") {
      assert.equal(out.failure.reason, "ai_invalid_output");
      assert.equal(out.failure.retryable, false);
      assert.deepEqual(out.progress, { done: 2, total: 2 });
    }
  });

  it("enforces the per-run verify budget across yields and retries", async () => {
    const job = withProgress(jobContext("verify_support"), VERIFY_CALLS_PER_RUN);
    const { ai, calls } = fakeAi();
    const out = await runVerifySupport(ctxFor("verify_support", supportDb([link(1)]), ai, { job }));
    assert.ok(out.kind === "failed" && out.failure.reason === "ai_budget_exceeded");
    assert.equal(calls.verify.length, 0);
  });

  it("provider_not_configured fails without a call", async () => {
    const { ai, calls } = fakeAi({ provider: { ok: false, error: providerNotConfiguredError() } });
    const out = await runVerifySupport(ctxFor("verify_support", supportDb([link(1)]), ai));
    assert.ok(out.kind === "failed" && out.failure.reason === "provider_not_configured" && !out.failure.retryable);
    assert.equal(calls.verify.length, 0);
  });
});
