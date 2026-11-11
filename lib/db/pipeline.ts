/**
 * Pipeline worker writes (§9.3, §10), service role only. Main's lib/pipeline and lib/ai call these;
 * they never write tables directly. Each SQL function takes the handover lock first (FOR SHARE for
 * child-row writes, FOR UPDATE when finishing a run), per §5.5 item 2.
 */

import { z } from "zod";

import type { ExclusionRule, ParsedSource } from "../contracts/parser";
import type { PointCategory, AccessLevel, QuoteCheck, SupportVerdict } from "../contracts/enums";
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

export async function claimJobs(adminDb: DbClient, limit = 5, leaseSeconds = 300): Promise<ClaimedJob[]> {
  return ((await callRpc(adminDb, "claim_processing_jobs", { p_limit: limit, p_lease_seconds: leaseSeconds })) ?? []) as ClaimedJob[];
}

/** Write AiProvenance when the job is claimed, BEFORE calling the provider (§11.8 rule 3). */
export const setJobProvenance = async (adminDb: DbClient, jobId: string, provenance: Record<string, unknown>) =>
  void (await callRpc(adminDb, "set_job_provenance", { p_job_id: jobId, p_provenance: provenance }));

/** `attempt` is a non-sensitive AiAttemptRecord; `errorMessage` must be structural, never content (§12.7). */
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
