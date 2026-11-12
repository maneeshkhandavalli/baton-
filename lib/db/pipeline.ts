/**
 * Pipeline worker writes (§9.3, §10), service role only. Main's lib/pipeline and lib/ai call these;
 * they never write tables directly. Each SQL function takes the handover lock first (FOR SHARE for
 * child-row writes, FOR UPDATE when finishing a run), per §5.5 item 2.
 */

import { z } from "zod";

import type { ExclusionRule, ParsedSource } from "../contracts/parser";
import type {
  AccessLevel,
  DateOrder,
  PipelineStage,
  PointCategory,
  QuoteCheck,
  SourceKind,
  SupportVerdict,
} from "../contracts/enums";
import { DATE_ORDERS, EXCLUSION_RULE_MODES, IDENTITY_KINDS, IDENTITY_PEPPER_VERSIONS } from "../contracts/enums";
import type { DbClient } from "./client";
import { DbError } from "./errors";
import { callRpc } from "./rpc";
import { hexToBytea, sha256Hex } from "./tokens";

export interface ClaimedJob {
  id: string;
  handover_id: string;
  run_id: string;
  source_id: string | null;
  stage: string;
  attempt: number;
  max_attempts: number;
}

/** @deprecated QA-N1: the SQL function is no longer executable by service_role; use claimReadyJobs. */
export async function claimJobs(adminDb: DbClient, limit = 5, leaseSeconds = 300): Promise<ClaimedJob[]> {
  return ((await callRpc(adminDb, "claim_processing_jobs", { p_limit: limit, p_lease_seconds: leaseSeconds })) ?? []) as ClaimedJob[];
}

/** Write AiProvenance when the job is claimed, BEFORE calling the provider (§11.8 rule 3). */
export const setJobProvenance = async (adminDb: DbClient, jobId: string, provenance: Record<string, unknown>) =>
  void (await callRpc(adminDb, "set_job_provenance", { p_job_id: jobId, p_provenance: provenance }));

/** @deprecated QA-N1: no longer executable; use completeJob (fenced). `attempt` is a non-sensitive AiAttemptRecord; `errorMessage` must be structural, never content (§12.7). */
export const recordJobAttempt = async (
  adminDb: DbClient,
  input: {
    jobId: string;
    outcome: "succeeded" | "retry" | "failed";
    attempt?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    nextAttemptAt?: string;
    progress?: { done: number; total: number };
  },
) =>
  void (await callRpc(adminDb, "record_job_attempt", {
    p_job_id: input.jobId,
    p_outcome: input.outcome,
    p_attempt: input.attempt ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_next_attempt_at: input.nextAttemptAt ?? null,
    p_progress_done: input.progress?.done ?? null,
    p_progress_total: input.progress?.total ?? null,
  }));

export const finishRun = async (
  adminDb: DbClient,
  input: { runId: string; status: "succeeded" | "failed" | "cancelled"; errorCode?: string; errorMessage?: string },
) =>
  void (await callRpc(adminDb, "finish_processing_run", {
    p_run_id: input.runId,
    p_status: input.status,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
  }));

const isoInstant = z.string().refine((v) => !Number.isNaN(Date.parse(v)));
const exclusionRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("participant"),
    ruleId: z.string().uuid(),
    identityKind: z.enum(IDENTITY_KINDS),
    participantIdentityHash: z.string().regex(/^[0-9a-f]{64}$/),
    identityPepperVersion: z.enum(IDENTITY_PEPPER_VERSIONS),
    mode: z.enum(EXCLUSION_RULE_MODES),
  }),
  z.strictObject({
    kind: z.literal("conversation"),
    ruleId: z.string().uuid(),
    conversationLocalId: z.string().regex(/^c_[1-9][0-9]*$/),
    context: z.strictObject({ timezone: z.string().min(1), dateOrder: z.enum(DATE_ORDERS).nullable(), parserVersion: z.string().min(1) }),
  }),
  z.strictObject({ kind: z.literal("date_range"), ruleId: z.string().uuid(), rangeStart: isoInstant, rangeEnd: isoInstant }),
]);

/**
 * The ExclusionRule[] for a source's preview AND final parse (§10.3, D33: the same list for both). R8:
 * handover-wide NAME rules come back with mode "detect" until the creator decides for this source
 * (§6.8.1); a detect match must fail the parse before anything is persisted, which persist_parsed_source
 * enforces again (precondition_failed, "identity_confirmation_required"). Malformed rules fail closed.
 */
export async function getParseExclusions(adminDb: DbClient, sourceId: string): Promise<ExclusionRule[]> {
  const parsed = z.array(exclusionRuleSchema).safeParse(await callRpc(adminDb, "parse_exclusion_rules", { p_source_id: sourceId }));
  if (!parsed.success) throw new DbError("internal");
  return parsed.data;
}

/** One transaction; fails closed for any pepper other than p1 or any excluded participant's messages. */
export const persistParsedSource = async (adminDb: DbClient, sourceId: string, parsed: ParsedSource, pepperVersion: "p1") =>
  void (await callRpc(adminDb, "persist_parsed_source", { p_source_id: sourceId, p_parsed: parsed, p_pepper_version: pepperVersion }));

export const markSourceParseFailed = async (adminDb: DbClient, sourceId: string, errorCode: string) =>
  void (await callRpc(adminDb, "mark_source_parse_failed", { p_source_id: sourceId, p_error_code: errorCode }));

export async function insertExtractedPoint(
  adminDb: DbClient,
  input: {
    handoverId: string;
    runId: string;
    category: PointCategory;
    title: string;
    statement: string;
    attributes: Record<string, unknown>;
    inferenceRationale: string | null;
    extractionAccessLevel: AccessLevel;
    aiProvenance: Record<string, unknown>;
    sortKey?: number;
  },
): Promise<string> {
  return (await callRpc(adminDb, "insert_extracted_point", {
    p_handover_id: input.handoverId,
    p_run_id: input.runId,
    p_category: input.category,
    p_title: input.title,
    p_statement: input.statement,
    p_attributes: input.attributes,
    p_inference_rationale: input.inferenceRationale,
    p_extraction_access_level: input.extractionAccessLevel,
    p_ai_provenance: input.aiProvenance,
    p_sort_key: input.sortKey ?? 0,
  })) as string;
}

/** Returns the point_evidence id (quotes are deduplicated by message span, §6.10). */
export async function addSourceQuoteEvidence(
  adminDb: DbClient,
  input: { pointId: string; sourceMessageId: string; quote: string; quoteStart: number | null; quoteEnd: number | null; quoteCheck: QuoteCheck },
): Promise<string> {
  return (await callRpc(adminDb, "add_source_quote_evidence", {
    p_point_id: input.pointId,
    p_source_message_id: input.sourceMessageId,
    p_quote_text: input.quote,
    p_quote_start: input.quoteStart,
    p_quote_end: input.quoteEnd,
    p_quote_check: input.quoteCheck,
  })) as string;
}

export const recordQuoteCheck = async (adminDb: DbClient, evidenceId: string, quoteCheck: QuoteCheck) =>
  void (await callRpc(adminDb, "record_quote_check", { p_evidence_id: evidenceId, p_quote_check: quoteCheck }));

/**
 * `verifiedQuoteText` is the exact text the verifier saw. If the evidence changed meanwhile (a privacy
 * redaction), the database refuses with conflict and the verdict must be discarded (§5.5 T6).
 */
export async function recordSupportVerdict(
  adminDb: DbClient,
  input: {
    pointEvidenceId: string;
    revisionId: string;
    verdict: Exclude<SupportVerdict, "unchecked">;
    rationale: string | null;
    provenance: Record<string, unknown>;
    verifiedQuoteText: string;
  },
): Promise<void> {
  await callRpc(adminDb, "record_support_verdict", {
    p_point_evidence_id: input.pointEvidenceId,
    p_revision_id: input.revisionId,
    p_verdict: input.verdict,
    p_rationale: input.rationale,
    p_provenance: input.provenance,
    p_quote_sha256: hexToBytea(await sha256Hex(input.verifiedQuoteText)),
  });
}

export async function createSystemGapQuestion(
  adminDb: DbClient,
  input: { handoverId: string; pointId: string | null; category: PointCategory | null; question: string; context: string | null; priority: "required" | "optional"; accessLevel: AccessLevel },
): Promise<string> {
  return (await callRpc(adminDb, "create_system_gap_question", {
    p_handover_id: input.handoverId,
    p_point_id: input.pointId,
    p_category: input.category,
    p_question: input.question,
    p_context: input.context,
    p_priority: input.priority,
    p_access_level: input.accessLevel,
  })) as string;
}

// ── Integration worker support (migration 20261112000100, docs/integration/interfaces.md) ─────────────
// Service role only. Every read returns masked, persisted data; nothing here touches raw uploads.

/** DB-1: claims only jobs whose earlier stages are terminal; reaps leases that expired on the last attempt. */
export async function claimReadyJobs(adminDb: DbClient, limit = 5, leaseSeconds = 300): Promise<ClaimedJob[]> {
  return ((await callRpc(adminDb, "claim_ready_processing_jobs", { p_limit: limit, p_lease_seconds: leaseSeconds })) ?? []) as ClaimedJob[];
}

export type JobCompletion = "succeeded" | "retry" | "failed" | "skipped" | "yield";

/**
 * DB-2: fenced completion. Throws DbError("conflict") when the job is no longer this claim's (lease lost,
 * run cancelled or finished); the caller must then record nothing else. `errorMessage` is a reason token
 * matching ^[a-z0-9_:]{1,64}$ (§12.7). Returns the job's new status.
 */
export async function completeJob(
  adminDb: DbClient,
  input: {
    jobId: string;
    attempt: number;
    outcome: JobCompletion;
    attemptRecord?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    nextAttemptAt?: string;
    progress?: { done: number; total: number };
  },
): Promise<"succeeded" | "queued" | "failed" | "cancelled"> {
  return (await callRpc(adminDb, "complete_processing_job", {
    p_job_id: input.jobId,
    p_attempt: input.attempt,
    p_outcome: input.outcome,
    p_attempt_record: input.attemptRecord ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_next_attempt_at: input.nextAttemptAt ?? null,
    p_progress_done: input.progress?.done ?? null,
    p_progress_total: input.progress?.total ?? null,
  })) as "succeeded" | "queued" | "failed" | "cancelled";
}

/** DB-3: extends the lease; returns the run status, or "lost" when the claim is no longer valid. */
export async function heartbeatJob(
  adminDb: DbClient,
  input: { jobId: string; attempt: number; leaseSeconds: number; progress?: { done: number; total: number } },
): Promise<"queued" | "running" | "lost"> {
  return (await callRpc(adminDb, "heartbeat_processing_job", {
    p_job_id: input.jobId,
    p_attempt: input.attempt,
    p_lease_seconds: input.leaseSeconds,
    p_progress_done: input.progress?.done ?? null,
    p_progress_total: input.progress?.total ?? null,
  })) as "queued" | "running" | "lost";
}

export interface JobContext {
  job: {
    id: string;
    runId: string;
    handoverId: string;
    sourceId: string | null;
    stage: PipelineStage;
    status: string;
    attempt: number;
    maxAttempts: number;
    inputHash: string;
    progressDone: number | null;
    progressTotal: number | null;
  };
  run: { status: string; pipelineVersion: string; aiProvider: string; aiConfig: Record<string, unknown>; sourceIds: string[] };
  handover: { state: string; teamName: string; roleTitle: string | null; deleted: boolean };
  source: null | {
    kind: SourceKind;
    state: string;
    accessLevel: AccessLevel;
    timezone: string;
    dateOrder: DateOrder | null;
    originalFilename: string;
    rawAvailable: boolean;
    consentAiProvider: string | null;
    documentDate: string | null;
    deleted: boolean;
  };
  /** A succeeded job with the same stage, source and input hash exists in another run of the handover. */
  priorSucceeded: boolean;
}

/** DB-4 */
export async function getJobContext(adminDb: DbClient, jobId: string): Promise<JobContext> {
  const data = await callRpc(adminDb, "get_processing_job_context", { p_job_id: jobId });
  if (!data) throw new DbError("not_found");
  return data as JobContext;
}

export interface ExtractionMessage {
  id: string;
  seq: number;
  conversationLocalId: string | null;
  authorLabel: string | null;
  sentAt: string | null;
  kind: "text" | "document_block";
  body: string;
}

/** DB-5: one page (at most 2000) of a parsed source's masked text messages after `afterSeq`, by seq. */
export async function listExtractionMessages(
  adminDb: DbClient,
  input: { sourceId: string; afterSeq: number; limit: number },
): Promise<{ accessLevel: AccessLevel; messages: ExtractionMessage[] }> {
  return (await callRpc(adminDb, "list_extraction_messages", {
    p_source_id: input.sourceId,
    p_after_seq: input.afterSeq,
    p_limit: input.limit,
  })) as { accessLevel: AccessLevel; messages: ExtractionMessage[] };
}

export interface PipelinePoint {
  pointId: string;
  category: PointCategory;
  origin: "extracted" | "gap_answer" | "manual";
  extractionRunId: string | null;
  extractionAccessLevel: AccessLevel | null;
  accessLevel: AccessLevel;
  evidenceStatus: string;
  reviewState: string;
  privacyReview: "none" | "required" | "cleared";
  currentRevisionId: string;
  /** null when the current revision is redacted */
  title: string | null;
  statement: string | null;
  attributes: Record<string, unknown> | null;
  redacted: boolean;
  newestEvidenceAt: string | null;
  lastSupportedAt: string | null;
}

/** DB-6: non-erased points with their current revision (§10.9 dedup and coverage, §10.10 ordering). */
export async function listPointsForPipeline(adminDb: DbClient, handoverId: string): Promise<PipelinePoint[]> {
  return ((await callRpc(adminDb, "list_points_for_pipeline", { p_handover_id: handoverId })) ?? []) as PipelinePoint[];
}

export interface PendingQuote {
  evidenceId: string;
  sourceMessageId: string | null;
  quoteText: string;
  quoteStart: number | null;
  quoteEnd: number | null;
  quoteCheck: QuoteCheck;
  /** null if the message was pruned; leave the row unchanged */
  messageBody: string | null;
}

/** DB-7: a source's pending source quotes with the persisted (masked) message body (§10.7). */
export async function listQuotesForCheck(adminDb: DbClient, sourceId: string): Promise<PendingQuote[]> {
  return ((await callRpc(adminDb, "list_quotes_for_check", { p_source_id: sourceId })) ?? []) as PendingQuote[];
}

export interface LinkNeedingSupport {
  pointEvidenceId: string;
  pointId: string;
  revisionId: string;
  claim: { category: PointCategory; title: string; statement: string; attributes: Record<string, unknown> };
  evidenceKind: "source_quote" | "testimony";
  quote: { text: string; authorLabel: string | null; sentAt: string | null };
  context: Array<{ authorLabel: string | null; sentAt: string | null; body: string }>;
}

/** DB-8: links whose verified quote has no verdict for the point's current revision (§10.8, D16). */
export async function listLinksNeedingSupport(adminDb: DbClient, handoverId: string, limit = 100): Promise<LinkNeedingSupport[]> {
  return ((await callRpc(adminDb, "list_links_needing_support", { p_handover_id: handoverId, p_limit: limit })) ??
    []) as LinkNeedingSupport[];
}

export interface PipelineGapQuestion {
  id: string;
  pointId: string | null;
  category: PointCategory | null;
  status: string;
  isSystem: boolean;
  /** system-authored questions only */
  question: string | null;
}

/** DB-9 */
export async function listGapQuestionsForPipeline(adminDb: DbClient, handoverId: string): Promise<PipelineGapQuestion[]> {
  return ((await callRpc(adminDb, "list_gap_questions_for_pipeline", { p_handover_id: handoverId })) ?? []) as PipelineGapQuestion[];
}

export interface RunJobState {
  id: string;
  stage: PipelineStage;
  sourceId: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  maxAttempts: number;
  errorCode: string | null;
  /** reason token only */
  errorMessage: string | null;
}

/** DB-14: the run's status and every job's state, ordered by stage (§9.3 run outcome). */
export async function listRunJobs(adminDb: DbClient, runId: string): Promise<{ runStatus: string; jobs: RunJobState[] }> {
  const data = await callRpc(adminDb, "list_run_jobs", { p_run_id: runId });
  if (!data) throw new DbError("not_found");
  return data as { runStatus: string; jobs: RunJobState[] };
}

/** DB-15: active runs that may need finishing (all jobs terminal, or some job failed). The caller decides. */
export async function listFinishableRuns(adminDb: DbClient, limit = 20): Promise<string[]> {
  return ((await callRpc(adminDb, "list_finishable_runs", { p_limit: limit })) ?? []) as string[];
}

/** DB-10: §10.10 review order, only inside the given active run. Returns the number of points updated. */
export async function setPointSortKeys(
  adminDb: DbClient,
  input: { handoverId: string; runId: string; keys: Array<{ pointId: string; sortKey: number }> },
): Promise<number> {
  return Number(
    await callRpc(adminDb, "set_point_sort_keys", { p_handover_id: input.handoverId, p_run_id: input.runId, p_keys: input.keys }),
  );
}
