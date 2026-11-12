/**
 * Pipeline worker writes (§9.3, §10), service role only. Main's lib/pipeline and lib/ai call these;
 * they never write tables directly. Each SQL function takes the handover lock first (FOR SHARE for
 * child-row writes, FOR UPDATE when finishing a run), per §5.5 item 2.
 *
 * DB-12 (Round 3): every job-scoped writer is FENCED. It takes the worker's `JobClaim` (job id + attempt)
 * and the database refuses the write unless that claim is still current at commit time (job running at
 * that attempt, lease unexpired, run active, stage allowed, target inside the job's handover/source;
 * migration 20261113300100). A refused claim throws `ClaimLostError`: the caller must stop and record
 * nothing else. DB-13: extraction persists one chunk's points + evidence + checkpoint atomically
 * (`storeExtractChunk`).
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

/** The worker's claim on one job: the fencing token every job-scoped writer takes (DB-12). */
export interface JobClaim {
  jobId: string;
  attempt: number;
}

/** SQLSTATE the fenced writers raise when the claim is no longer current (lost lease, reclaimed, reaped, finished, run ended). */
export const CLAIM_LOST_SQLSTATE = "BTLL0";

/**
 * The claim is no longer ours. Deliberately NOT a DbError, so stage code that handles DbError
 * (conflict, not_found, ...) can never mistake a fencing refusal for a data condition and keep going.
 */
export class ClaimLostError extends Error {
  constructor() {
    super("claim lost");
    this.name = "ClaimLostError";
  }
}

/** SQLSTATEs meaning "this database has no such function": PostgREST PGRST202, Postgres 42883. */
const MISSING_FUNCTION_STATES: ReadonlySet<string> = new Set(["PGRST202", "42883"]);

/**
 * The database lacks the fenced writer (migrations 2026111330* not applied). Never falls back to an
 * unfenced writer (that would defeat DB-12); the runner fails the run loudly with `db_schema_outdated`.
 */
export class PipelineSchemaError extends Error {
  readonly fn: string;
  constructor(fn: string) {
    super("pipeline database functions are missing");
    this.name = "PipelineSchemaError";
    this.fn = fn;
  }
}

async function fencedRpc(adminDb: DbClient, fn: string, claim: JobClaim, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await callRpc(adminDb, fn, { p_job_id: claim.jobId, p_attempt: claim.attempt, ...args });
  } catch (e) {
    if (e instanceof DbError && e.sqlState === CLAIM_LOST_SQLSTATE) throw new ClaimLostError();
    if (e instanceof DbError && e.sqlState !== undefined && MISSING_FUNCTION_STATES.has(e.sqlState)) throw new PipelineSchemaError(fn);
    throw e;
  }
}

export interface ClaimedJob {
  id: string;
  handover_id: string;
  run_id: string;
  source_id: string | null;
  stage: string;
  attempt: number;
  max_attempts: number;
}

/** Write AiProvenance when the job is claimed, BEFORE calling the provider (§11.8 rule 3). Fenced (DB-12). */
export const setJobProvenance = async (adminDb: DbClient, claim: JobClaim, provenance: Record<string, unknown>) =>
  void (await fencedRpc(adminDb, "pipeline_set_job_provenance", claim, { p_provenance: provenance }));

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

/**
 * One transaction; fails closed for any pepper other than p1 or any excluded participant's messages.
 * Fenced (DB-12): the source is the parse job's own source.
 */
export const persistParsedSource = async (adminDb: DbClient, claim: JobClaim, parsed: ParsedSource, pepperVersion: "p1") =>
  void (await fencedRpc(adminDb, "pipeline_persist_parsed_source", claim, { p_parsed: parsed, p_pepper_version: pepperVersion }));

/** Fenced (DB-12): marks the parse job's own source failed. */
export const markSourceParseFailed = async (adminDb: DbClient, claim: JobClaim, errorCode: string) =>
  void (await fencedRpc(adminDb, "pipeline_mark_source_parse_failed", claim, { p_error_code: errorCode }));

export interface ExtractChunkCitation {
  messageId: string;
  /** `matchedText` for exact/normalized, the model's quote for not_found (stored `pending`). */
  quote: string;
  quoteStart: number | null;
  quoteEnd: number | null;
}

export interface NewExtractedPoint {
  category: PointCategory;
  title: string;
  statement: string;
  attributes: Record<string, unknown>;
  inferenceRationale: string | null;
}

/** Either attach citations to an existing point (`pointId`) or create a new point (`point`). */
export type ExtractChunkEntry =
  | { pointId: string; citations: ExtractChunkCitation[] }
  | { point: NewExtractedPoint; citations: ExtractChunkCitation[] };

export interface ExtractChunkEntryResult {
  /** null when a new point had no surviving citation and was therefore not inserted */
  pointId: string | null;
  inserted: boolean;
  citations: number;
  rejected: number;
  /** the target point was erased since it was read; nothing was attached */
  skipped: boolean;
}

/**
 * DB-13: one extraction chunk in ONE transaction: new points, their source-quote evidence (stored
 * `pending`) and the job checkpoint (`progress_done = chunkIndex + 1`). No point is stored without at
 * least one surviving citation, nothing is stored if any entry fails, and a chunk below the checkpoint is
 * a no-op (`alreadyCommitted`), so a retry never duplicates a chunk. Fenced (DB-12).
 */
export async function storeExtractChunk(
  adminDb: DbClient,
  claim: JobClaim,
  input: {
    chunkIndex: number;
    chunkTotal: number;
    accessLevel: AccessLevel;
    aiProvenance: Record<string, unknown>;
    entries: ExtractChunkEntry[];
  },
): Promise<{ alreadyCommitted: boolean; entries: ExtractChunkEntryResult[] }> {
  const data = (await fencedRpc(adminDb, "pipeline_store_extract_chunk", claim, {
    p_chunk_index: input.chunkIndex,
    p_chunk_total: input.chunkTotal,
    p_access_level: input.accessLevel,
    p_ai_provenance: input.aiProvenance,
    p_entries: input.entries.map((e) =>
      "pointId" in e ? { pointId: e.pointId, point: null, citations: e.citations } : { pointId: null, point: e.point, citations: e.citations },
    ),
  })) as { alreadyCommitted?: boolean; entries?: ExtractChunkEntryResult[] } | null;
  if (!data || !Array.isArray(data.entries)) throw new DbError("internal");
  const alreadyCommitted = data.alreadyCommitted === true;
  if (!alreadyCommitted && data.entries.length !== input.entries.length) throw new DbError("internal");
  return { alreadyCommitted, entries: data.entries };
}

/** Fenced (DB-12): only the verify_quotes job of the evidence's own source may record its check. */
export const recordQuoteCheck = async (adminDb: DbClient, claim: JobClaim, evidenceId: string, quoteCheck: QuoteCheck) =>
  void (await fencedRpc(adminDb, "pipeline_record_quote_check", claim, { p_evidence_id: evidenceId, p_quote_check: quoteCheck }));

/**
 * `verifiedQuoteText` is the exact text the verifier saw. If the evidence changed meanwhile (a privacy
 * redaction), the database refuses with conflict and the verdict must be discarded (§5.5 T6). Fenced (DB-12).
 */
export async function recordSupportVerdict(
  adminDb: DbClient,
  claim: JobClaim,
  input: {
    pointEvidenceId: string;
    revisionId: string;
    verdict: Exclude<SupportVerdict, "unchecked">;
    rationale: string | null;
    provenance: Record<string, unknown>;
    verifiedQuoteText: string;
  },
): Promise<void> {
  await fencedRpc(adminDb, "pipeline_record_support_verdict", claim, {
    p_point_evidence_id: input.pointEvidenceId,
    p_revision_id: input.revisionId,
    p_verdict: input.verdict,
    p_rationale: input.rationale,
    p_provenance: input.provenance,
    p_quote_sha256: hexToBytea(await sha256Hex(input.verifiedQuoteText)),
  });
}

/** Fenced (DB-12): analyze / prepare_review only; the question lands in the job's own handover. */
export async function createSystemGapQuestion(
  adminDb: DbClient,
  claim: JobClaim,
  input: { pointId: string | null; category: PointCategory | null; question: string; context: string | null; priority: "required" | "optional"; accessLevel: AccessLevel },
): Promise<string> {
  return (await fencedRpc(adminDb, "pipeline_create_system_gap_question", claim, {
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

/** DB-10: §10.10 review order, only inside the job's active run. Returns the number of points updated. Fenced (DB-12). */
export async function setPointSortKeys(adminDb: DbClient, claim: JobClaim, keys: Array<{ pointId: string; sortKey: number }>): Promise<number> {
  return Number(await fencedRpc(adminDb, "pipeline_set_point_sort_keys", claim, { p_keys: keys }));
}
