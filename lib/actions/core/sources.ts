/** Source actions (§6.5, §6.8, §10.3, §11.3). */

import type { Result } from "../../contracts/api";
import type { SourceSummary, SourceUploadTicket } from "../../contracts/dto";
import type { SourcePreview } from "../../contracts/parser";
import {
  addExclusionInput,
  confirmIdentityMatchInput,
  createSourceUploadInput,
  recordSourceConsentInput,
  sourceIdInput,
} from "../../contracts/schemas";
import type {
  AddExclusionInput,
  ConfirmIdentityMatchInput,
  CreateSourceUploadInput,
  RecordSourceConsentInput,
} from "../../contracts/schemas";
import * as mutations from "../../db/mutations";
import { getSourceSummary } from "../../db/queries";
import { confirmSourceUpload, createSourceUpload as createSignedSourceUpload, deleteRawSource } from "../../db/storage";
import { createInputMasker } from "./mask";
import { action, failWith, ok, parseInput } from "./run";
import type { ActionDeps } from "./types";

/**
 * Creates the source row (role, lifecycle and the 10-source limit are checked in SQL) and signs a
 * direct-to-storage upload with the user's storage client. The file name becomes the source title, so it
 * is masked like any other persisted text (a chat export is often named after a phone number).
 */
export async function createSourceUpload(deps: ActionDeps, input: CreateSourceUploadInput): Promise<Result<SourceUploadTicket>> {
  return action(deps, createSourceUploadInput, input, async (actor, v) => {
    const masked = parseInput(createSourceUploadInput, { ...v, fileName: createInputMasker().text(v.fileName) });
    if (!masked.ok) return masked;
    return ok(await createSignedSourceUpload(deps.adminDb(), actor, await deps.userStorage(), masked.data));
  });
}

/** M5: the server measures the uploaded object; the database compares it with the declared values. */
export async function confirmSourceUploaded(deps: ActionDeps, input: { sourceId: string }): Promise<Result<SourceSummary>> {
  return action(deps, sourceIdInput, input, async (actor, v) => {
    await confirmSourceUpload(deps.adminDb(), deps.adminStorage(), actor, v.sourceId);
    return getSourceSummary(deps.userDb, v.sourceId);
  });
}

/**
 * B3: wired to lib/db loadRawSourceForPreview, getParseExclusions, lib/pipeline getVerifiedPepper and the
 * parser once lib/pipeline is merged. Until then it fails closed: without a verified identity pepper no
 * source may be parsed (D27/D30), so no preview is produced and nothing is read.
 */
export async function previewSource(deps: ActionDeps, input: { sourceId: string }): Promise<Result<SourcePreview>> {
  return action(deps, sourceIdInput, input, async () =>
    failWith("precondition_failed", { details: { reason: "identity_pepper_unavailable" } }),
  );
}

/**
 * Records the server-configured AI provider (`runConfig.provider`), never one from the request (§11.8
 * rule 5). Without a configured provider nothing is written: precondition_failed, provider_not_configured.
 */
export async function recordSourceConsent(deps: ActionDeps, input: RecordSourceConsentInput): Promise<Result<SourceSummary>> {
  return action(deps, recordSourceConsentInput, input, async (actor, v) => {
    const provider = deps.consentProvider();
    if (!provider.ok) return provider;
    await mutations.recordSourceConsent(deps.adminDb(), actor, {
      sourceId: v.sourceId,
      consentStatementVersion: v.consentStatementVersion,
      aiProvider: provider.data,
      accessLevel: v.accessLevel,
      timezone: v.timezone,
      dateOrder: v.dateOrder,
      documentDate: v.documentDate,
    });
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
