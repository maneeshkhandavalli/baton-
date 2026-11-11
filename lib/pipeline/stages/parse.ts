/**
 * `parse` job (§10.3 steps 3–5, D14, §12.8 point 9).
 *
 * 1. Fail closed without a verified identity pepper (retryable `processing_failed`).
 * 2. The SAME exclusion rules as the preview (`getParseExclusions`); malformed rules fail closed.
 * 3. Raw bytes re-verified against the confirmed size and SHA-256 (`downloadVerifiedRawSourceWithMeta`).
 * 4. `parseSource` drops excluded content and masks in memory; nothing is persisted before step 6.
 * 5. Any `identityMatches` entry stops here (`identity_confirmation_required`).
 * 6. `persistParsedSource`: participants, conversations and masked messages in ONE transaction.
 * 7. Only after that commit, `deleteParsedRawSource`. A failed delete is left to the retention sweep.
 *
 * Every failure before the commit keeps the raw upload for a retry; non-retryable ones mark the source
 * `failed` with a structural error code.
 */

import { isParserInputFailure, type ParsedSource } from "../../contracts/parser";
import { DbError } from "../../db/errors";
import { getParseExclusions, markSourceParseFailed, persistParsedSource } from "../../db/pipeline";
import { deleteParsedRawSource, downloadVerifiedRawSourceWithMeta } from "../../db/storage";
import { parseSource } from "../../parsers/parse-source";
import type { StageContext } from "../stage-context";
import { failed, type FailureReason, type StageOutcome } from "../types";

async function markFailed(ctx: StageContext, sourceId: string, errorCode: string): Promise<void> {
  try {
    await markSourceParseFailed(ctx.db, sourceId, errorCode);
  } catch (e) {
    ctx.logger.warn("source_mark_failed_error", { jobId: ctx.claimed.id, sourceId, code: e instanceof DbError ? e.code : "internal" });
  }
}

/** Fail the source (raw kept) and the job, non-retryable. */
async function failSource(
  ctx: StageContext,
  sourceId: string,
  code: Parameters<typeof failed>[0],
  reason: FailureReason,
  sourceErrorCode: string,
): Promise<StageOutcome> {
  await markFailed(ctx, sourceId, sourceErrorCode);
  return failed(code, reason);
}

export async function runParse(ctx: StageContext): Promise<StageOutcome> {
  const sourceId = ctx.job.job.sourceId;
  const source = ctx.job.source;
  if (!sourceId || !source || source.deleted || source.state === "removed" || source.state === "pending_upload") {
    return failed("precondition_failed", "source_unavailable");
  }

  // Idempotent re-run: the commit happened but the job was not recorded (crash, lost lease).
  if (source.state === "parsed") {
    if (source.rawAvailable) await deleteRaw(ctx, sourceId);
    return { kind: "succeeded", progress: { done: 1, total: 1 } };
  }

  const pepper = ctx.getPepper();
  if (!pepper.ok) {
    ctx.logger.error("identity_pepper_unverified", { jobId: ctx.claimed.id, sourceId, check: String(pepper.error.details?.check ?? "") });
    return failed("processing_failed", "identity_pepper_unverified", true);
  }

  let exclusions;
  try {
    exclusions = await getParseExclusions(ctx.db, sourceId);
  } catch (e) {
    if (e instanceof DbError && e.code === "internal" && !e.sqlState) return failed("internal", "exclusions_invalid");
    throw e;
  }

  let raw;
  try {
    raw = await downloadVerifiedRawSourceWithMeta(ctx.db, ctx.storage, sourceId);
  } catch (e) {
    if (e instanceof DbError && e.code === "validation_failed") return failed("validation_failed", "integrity_mismatch"); // already marked failed
    if (e instanceof DbError && e.code === "not_found") return failed("processing_failed", "raw_unavailable", true); // raw kept; retry
    throw e;
  }

  const result = await parseSource({
    kind: raw.kind,
    fileName: raw.originalFilename,
    bytes: raw.bytes,
    timezone: raw.timezone,
    ...(raw.dateOrder ? { dateOrder: raw.dateOrder } : {}),
    exclusions,
    identityPepper: pepper.data.pepper,
  });

  if (!result.ok) {
    const err = result.error;
    if (isParserInputFailure(err)) {
      const inputCode = err.details.inputCode;
      if (inputCode === "identity_pepper_invalid") return failed("processing_failed", "identity_pepper_unverified", true);
      return failSource(ctx, sourceId, err.code, `input:${inputCode}`, inputCode);
    }
    return failSource(ctx, sourceId, err.code, `parser:${err.details.parserCode}`, err.details.parserCode);
  }

  const parsed: ParsedSource = result.data;
  if (parsed.identityMatches.length > 0) {
    return failSource(ctx, sourceId, "precondition_failed", "identity_confirmation_required", "identity_confirmation_required");
  }

  await ctx.heartbeat(); // never persist under a claim that is no longer ours

  try {
    await persistParsedSource(ctx.db, sourceId, parsed, pepper.data.version);
  } catch (e) {
    if (e instanceof DbError && !e.retryable) {
      if (e.code === "precondition_failed") {
        return failSource(ctx, sourceId, "precondition_failed", "identity_confirmation_required", "identity_confirmation_required");
      }
      if (e.code === "conflict") {
        return failSource(ctx, sourceId, "conflict", "excluded_participant_content", "excluded_participant_content");
      }
      if (e.code === "invalid_transition") return failed("invalid_transition", "run_inactive");
    }
    throw e;
  }

  ctx.logger.info("source_parsed", {
    jobId: ctx.claimed.id,
    sourceId,
    messages: parsed.messages.length,
    participants: parsed.participants.length,
    messagesExcluded: parsed.stats.messagesExcluded,
  });

  await deleteRaw(ctx, sourceId); // §10.3 step 4: only after the commit above
  return { kind: "succeeded", progress: { done: 1, total: 1 } };
}

async function deleteRaw(ctx: StageContext, sourceId: string): Promise<void> {
  try {
    await deleteParsedRawSource(ctx.db, ctx.storage, sourceId);
  } catch (e) {
    ctx.logger.warn("raw_delete_deferred", { jobId: ctx.claimed.id, sourceId, code: e instanceof DbError ? e.code : "internal" });
  }
}
