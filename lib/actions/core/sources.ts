/** Source actions (§6.5, §6.8, §10.3, §11.3). */

import type { Result } from "../../contracts/api";
import { CONSENT_STATEMENT_OUTDATED_MESSAGE, CONSENT_STATEMENT_OUTDATED_REASON, disclosureProviderId } from "../../contracts/consent";
import type { SourceSummary, SourceUploadTicket, SourceVersionUploadResult } from "../../contracts/dto";
import { ACCESS_LEVELS } from "../../contracts/enums";
import type { ParserFailure, SourcePreview } from "../../contracts/parser";
import {
  addExclusionInput,
  confirmIdentityMatchInput,
  createSourceUploadInput,
  createSourceVersionUploadInput,
  recordSourceConsentInput,
  sourceIdInput,
} from "../../contracts/schemas";
import type {
  AddExclusionInput,
  ConfirmIdentityMatchInput,
  CreateSourceUploadInput,
  CreateSourceVersionUploadInput,
  RecordSourceConsentInput,
} from "../../contracts/schemas";
import {
  isPendingSourceVersion,
  SOURCE_VERSION_ACCESS_BROADENED_MESSAGE,
  SOURCE_VERSION_ACCESS_BROADENED_REASON,
  SOURCE_VERSION_KIND_MESSAGE,
  SOURCE_VERSION_KIND_REASON,
  SOURCE_VERSION_REFUSALS,
  SOURCE_VERSION_STALE_REASON,
} from "../../contracts/source-versions";
import { isDbError } from "../../db/errors";
import * as mutations from "../../db/mutations";
import { getParseExclusions } from "../../db/pipeline";
import { getSourceSummary } from "../../db/queries";
import {
  confirmSourceUpload,
  createSourceUpload as createSignedSourceUpload,
  createSourceVersionUpload as createSignedSourceVersionUpload,
  deleteRawSource,
  loadRawSourceForPreview,
} from "../../db/storage";
import { createInputMasker } from "./mask";
import { refuseDemoContent } from "./demo-guard";
import { action, failWith, ok, parseInput, type Failure } from "./run";
import type { ActionDeps } from "./types";

/**
 * Creates the source row (role, lifecycle and the 10-source limit are checked in SQL) and signs a
 * direct-to-storage upload with the user's storage client. The file name becomes the source title, so it
 * is masked like any other persisted text (a chat export is often named after a phone number).
 */
export async function createSourceUpload(deps: ActionDeps, input: CreateSourceUploadInput): Promise<Result<SourceUploadTicket>> {
  return action(deps, createSourceUploadInput, input, async (actor, v) => {
    const demo = refuseDemoContent(actor); // F3: shared demo accounts can't add content or spend on AI
    if (demo) return demo;
    const masked = parseInput(createSourceUploadInput, { ...v, fileName: createInputMasker().text(v.fileName) });
    if (!masked.ok) return masked;
    try {
      return ok(await createSignedSourceUpload(deps.adminDb(), actor, await deps.userStorage(), masked.data));
    } catch (error) {
      // R3 C3: create_source's only non-retryable conflict is the (handover_id, sha256) duplicate of a live source.
      if (isDbError(error) && error.code === "conflict" && !error.retryable) {
        return failWith("conflict", { message: DUPLICATE_SOURCE_MESSAGE, details: { reason: DUPLICATE_SOURCE_REASON } });
      }
      throw error;
    }
  });
}

/**
 * R3 C3/C5: the same file (same SHA-256) is already a live source of this handover: uploaded, parsed or
 * failed, or still being uploaded by ANOTHER member. The actor's own unfinished upload is not a duplicate:
 * create_source reuses (or replaces) that row and a fresh ticket is returned (migration 20261113100300).
 */
export const DUPLICATE_SOURCE_MESSAGE =
  "This file is already in this handover (or another member is uploading it), so there is no need to add it again.";
export const DUPLICATE_SOURCE_REASON = "duplicate_source";

/**
 * R3 Task 05B: starts a NEW VERSION of an existing source (creator only, checked in SQL). The creator names the
 * source being replaced; the database checks that it is still the current version, locks its lineage, and either
 * creates a pending update (an upload ticket is returned) or says why not. Identical content is a no-op. The
 * file name is masked like any other persisted text. The steps after the upload are the existing ones:
 * confirmSourceUploaded, then recordSourceConsent, which activates the version (fresh consent, decision 5).
 */
export async function createSourceVersionUpload(
  deps: ActionDeps,
  input: CreateSourceVersionUploadInput,
): Promise<Result<SourceVersionUploadResult>> {
  return action(deps, createSourceVersionUploadInput, input, async (actor, v) => {
    const demo = refuseDemoContent(actor); // F3: shared demo accounts can't add content or spend on AI
    if (demo) return demo;
    const masked = parseInput(createSourceVersionUploadInput, { ...v, fileName: createInputMasker().text(v.fileName) });
    if (!masked.ok) return masked;
    let r: Awaited<ReturnType<typeof createSignedSourceVersionUpload>>;
    try {
      r = await createSignedSourceVersionUpload(deps.adminDb(), actor, await deps.userStorage(), masked.data);
    } catch (error) {
      if (isDbError(error) && error.code === "conflict" && !error.retryable) {
        return failWith("conflict", { message: DUPLICATE_SOURCE_MESSAGE, details: { reason: DUPLICATE_SOURCE_REASON } });
      }
      if (isDbError(error) && error.code === "validation_failed") {
        // the input passed its shape checks, so this is a file that cannot be this kind of source (or the
        // database's same-kind rule for versions)
        return failWith("validation_failed", { message: SOURCE_VERSION_KIND_MESSAGE, details: { reason: SOURCE_VERSION_KIND_REASON } });
      }
      throw error;
    }
    switch (r.outcome) {
      case "created":
      case "resumed":
        if (!r.ticket) return failWith("internal");
        return ok<SourceVersionUploadResult>({ status: "upload", ticket: r.ticket });
      case "awaiting_confirmation":
      case "awaiting_consent":
      case "unchanged":
        if (!r.sourceId) return failWith("internal");
        return ok<SourceVersionUploadResult>({ status: r.outcome, sourceId: r.sourceId });
      default: {
        const refusal = SOURCE_VERSION_REFUSALS[r.outcome];
        return failWith(refusal.code, {
          message: refusal.message,
          details: r.sourceId ? { reason: r.outcome, sourceId: r.sourceId } : { reason: r.outcome },
        });
      }
    }
  });
}

/** M5: the server measures the uploaded object; the database compares it with the declared values. */
export async function confirmSourceUploaded(deps: ActionDeps, input: { sourceId: string }): Promise<Result<SourceSummary>> {
  return action(deps, sourceIdInput, input, async (actor, v) => {
    const demo = refuseDemoContent(actor); // F3: shared demo accounts can't add content or spend on AI
    if (demo) return demo;
    await confirmSourceUpload(deps.adminDb(), deps.adminStorage(), actor, v.sourceId);
    return getSourceSummary(deps.userDb, v.sourceId);
  });
}

/** Only these structural parser details reach the client; never content, names or values (§11.4). */
const PARSER_DETAIL_KEYS = ["parserCode", "inputCode", "field", "ruleId", "line"] as const;

/** ParserFailure → AppError with the same typed code, a fixed safe message and structural details only. */
function parserFailure(error: ParserFailure): Failure {
  const details: Record<string, string | number | boolean> = {};
  const source = error.details as Record<string, unknown>;
  for (const key of PARSER_DETAIL_KEYS) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") details[key] = value;
  }
  return failWith(error.code, { details, retryable: error.retryable === true });
}

/**
 * Read-only preview (§10.3 step 1, D14, D33). The actor-checked raw load (R2: creator or outgoing member,
 * uploaded or failed source, raw present, consent recorded) runs FIRST; only then are the exclusion rules
 * read with the service role. The parser gets the same rules as the final parse. Nothing is persisted, the
 * source state and the raw upload are never changed, and the contract SourcePreview is returned as is
 * (Q1 open).
 */
export async function previewSource(deps: ActionDeps, input: { sourceId: string }): Promise<Result<SourcePreview>> {
  return action(
    deps,
    sourceIdInput,
    input,
    async (actor, v) => {
      const db = deps.adminDb();
      const raw = await loadRawSourceForPreview(db, deps.adminStorage(), actor, v.sourceId);
      const exclusions = await getParseExclusions(db, v.sourceId);
      const pepper = deps.verifiedPepper();
      if (!pepper.ok) return pepper;
      const preview = await deps.previewParser({
        kind: raw.kind,
        fileName: raw.originalFilename,
        bytes: raw.bytes,
        timezone: raw.timezone,
        ...(raw.dateOrder ? { dateOrder: raw.dateOrder } : {}),
        exclusions,
        identityPepper: pepper.data.pepper,
      });
      return preview.ok ? ok(preview.data) : parserFailure(preview.error);
    },
    { refresh: false },
  );
}

/**
 * Records the server-configured AI provider (`runConfig.provider`), never one from the request (§11.8
 * rule 5). Without a configured provider nothing is written: precondition_failed, provider_not_configured.
 */
export async function recordSourceConsent(deps: ActionDeps, input: RecordSourceConsentInput): Promise<Result<SourceSummary>> {
  return action(deps, recordSourceConsentInput, input, async (actor, v) => {
    const demo = refuseDemoContent(actor); // F3: shared demo accounts can't add content or spend on AI
    if (demo) return demo;
    const ai = deps.aiRunConfig();
    if (!ai.ok) return ai;
    // R3 Task 05E: the statement must be exactly the wording this server shows for its ACTUAL configuration. The
    // expected version is derived on the server; a stale or forged version (or one for another provider) is refused
    // before anything is written. The recorded provider is always the server's (never the request's).
    const expected = deps.consentDisclosure();
    if (disclosureProviderId(expected.kind) !== ai.data.provider) {
      return failWith("precondition_failed", {
        message: "AI processing isn't set up on this server yet. Ask the workspace admin.",
        details: { reason: "provider_not_configured" },
      });
    }
    if (v.consentStatementVersion !== expected.statementVersion) {
      return failWith("conflict", { message: CONSENT_STATEMENT_OUTDATED_MESSAGE, details: { reason: CONSENT_STATEMENT_OUTDATED_REASON } });
    }
    // R3 Task 05B: recording consent on a pending update ACTIVATES it. Its access level starts as the previous
    // version's (copied when the update was created): that is the default when the caller names none, and it
    // may not become broader (the database enforces this too).
    let accessLevel = v.accessLevel;
    let pendingVersion = false;
    const current = await getSourceSummary(deps.userDb, v.sourceId);
    if (current.ok && isPendingSourceVersion(current.data)) {
      pendingVersion = true;
      const floor = current.data.accessLevel;
      if ((input as { accessLevel?: unknown }).accessLevel === undefined) accessLevel = floor;
      if (ACCESS_LEVELS.indexOf(accessLevel) < ACCESS_LEVELS.indexOf(floor)) {
        return failWith("validation_failed", {
          message: SOURCE_VERSION_ACCESS_BROADENED_MESSAGE,
          details: { reason: SOURCE_VERSION_ACCESS_BROADENED_REASON },
        });
      }
    }
    try {
      await mutations.recordSourceConsent(deps.adminDb(), actor, {
        sourceId: v.sourceId,
        consentStatementVersion: v.consentStatementVersion,
        aiProvider: ai.data.provider,
        accessLevel,
        timezone: v.timezone,
        dateOrder: v.dateOrder,
        documentDate: v.documentDate,
      });
    } catch (error) {
      // the only non-retryable conflict of an activation: the replaced version is no longer the current one
      if (pendingVersion && isDbError(error) && error.code === "conflict" && !error.retryable) {
        return failWith("conflict", { message: SOURCE_VERSION_REFUSALS.stale.message, details: { reason: SOURCE_VERSION_STALE_REASON } });
      }
      throw error;
    }
    return getSourceSummary(deps.userDb, v.sourceId);
  });
}

/** Pre-parse only; the database derives the handover from the source and refuses parsed sources. */
export async function addExclusion(deps: ActionDeps, input: AddExclusionInput): Promise<Result<{ exclusionId: string }>> {
  return action(deps, addExclusionInput, input, async (actor, v) => {
    const masked = parseInput(addExclusionInput, { ...v, reason: createInputMasker().optional(v.reason) });
    if (!masked.ok) return masked;
    return ok(await mutations.addExclusion(deps.adminDb(), actor, masked.data));
  });
}

/** Creator only (§6.8.1); checked in SQL. */
export async function confirmIdentityMatch(deps: ActionDeps, input: ConfirmIdentityMatchInput): Promise<Result<null>> {
  return action(deps, confirmIdentityMatchInput, input, async (actor, v) => {
    await mutations.confirmIdentityMatch(deps.adminDb(), actor, v);
    return ok(null);
  });
}

/**
 * Soft-deletes the source, then (only after that commit) deletes the raw upload (§12.6). If the storage
 * delete fails, raw_storage_path stays set and the retention sweep retries it, so the action still succeeds.
 */
export async function removeSource(deps: ActionDeps, input: { sourceId: string }): Promise<Result<null>> {
  return action(deps, sourceIdInput, input, async (actor, v) => {
    const demo = refuseDemoContent(actor); // F3: shared demo accounts can't add content or spend on AI
    if (demo) return demo;
    const db = deps.adminDb();
    const rawPath = await mutations.removeSource(db, actor, v.sourceId);
    if (rawPath) {
      try {
        await deleteRawSource(db, deps.adminStorage(), v.sourceId, rawPath);
      } catch {
        // retried by the retention sweep (§12.6)
      }
    }
    return ok(null);
  });
}
