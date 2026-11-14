/**
 * Pure draft-state helpers for the New Handover wizard (BTN-006/007): how a saved source is shown when a
 * draft is reopened, which step a reopened draft lands on, and where a signed upload goes. Kept free of
 * React and of server code so they are unit-tested (components/wizard/__tests__/draft-state.test.ts).
 */

import type { SourceSummary } from "@/lib/contracts/dto";
import type { AccessLevel, DateOrder, SourceKind } from "@/lib/contracts/enums";
import type { SourcePreview } from "@/lib/contracts/parser";
import type { UploadPhase } from "@/components/shared/upload-status";

export type SourceStatus = "hashing" | "uploading" | "verifying" | "consent" | "previewing" | "ready" | "error";

export interface DraftSource {
  localId: string;
  name: string;
  size: number;
  kind: SourceKind;
  status: SourceStatus;
  error?: string;
  /** Why an `error` source failed, so the row can show the right state and action (duplicate, too large…). */
  errorPhase?: UploadPhase;
  /** Kept in memory only, so a failed upload can be retried without choosing the file again. */
  file?: File;
  sourceId?: string;
  preview?: SourcePreview;
  accessLevel: AccessLevel;
  excludedConversations: string[];
  /** Participant local ids ticked off and not saved yet. Saved ones disappear from the preview (D33). */
  excludedParticipants: string[];
  /** How many people were left out of this source and saved (they're no longer in the preview). */
  savedParticipantExclusions: number;
  rangeFrom: string;
  rangeTo: string;
  documentDate: string;
  /** Set when the chat's dates are ambiguous (DD/MM vs MM/DD): the creator must choose (parser date_format_ambiguous). */
  needsDateOrder?: boolean;
  /** The creator's choice; recorded on the consent so the preview and the final parse use the same context (D32/D33). */
  dateOrder?: DateOrder;
}

export const blankSource = (over: Partial<DraftSource> & Pick<DraftSource, "localId" | "name" | "size" | "kind" | "status">): DraftSource => ({
  accessLevel: "everyone",
  excludedConversations: [],
  excludedParticipants: [],
  savedParticipantExclusions: 0,
  rangeFrom: "",
  rangeTo: "",
  documentDate: "",
  ...over,
});

/** A source reopened from the server: uploaded + consented ones are previewed again; unfinished ones say so. */
export function fromSummary(s: SourceSummary, consentGiven: boolean): DraftSource {
  const base = { localId: s.id, sourceId: s.id, name: s.title, size: s.sizeBytes, kind: s.kind, accessLevel: s.accessLevel };
  if (s.state === "uploaded" && s.consentRecordedAt) return blankSource({ ...base, status: "previewing" });
  if (s.state === "uploaded" && consentGiven) return blankSource({ ...base, status: "consent" });
  if (s.state === "uploaded") return blankSource({ ...base, status: "error", error: "Give consent in step 2, then remove and add this file again." });
  if (s.state === "pending_upload") return blankSource({ ...base, status: "error", error: "This upload didn't finish. Remove it and add the file again." });
  return blankSource({ ...base, status: "error", error: "This source can't be prepared here. Remove it and add the file again." });
}

/** Bucket and object path from a Supabase signed upload URL (…/object/upload/sign/<bucket>/<path>?token=…). */
export function signedTarget(signedUploadUrl: string): { bucket: string; path: string } | null {
  try {
    const m = /\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(new URL(signedUploadUrl).pathname);
    return m ? { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) } : null;
  } catch {
    return null;
  }
}

/**
 * The step a reopened draft opens on: the `step` query value when it is a whole number, otherwise the
 * consent step for a draft with no sources yet and the sources step when it has some. The wizard itself
 * never shows a step ahead of what the draft really holds.
 */
export function resumeStep(stepParam: string | undefined, liveSourceCount: number): number {
  const n = Number(stepParam ?? NaN);
  return Number.isInteger(n) ? n : liveSourceCount > 0 ? 2 : 1;
}

/** Furthest step the wizard may show for the draft's real state. */
export function maxStepFor(state: { hasDraft: boolean; consentGiven: boolean; readySources: number }, lastStep: number): number {
  return !state.hasDraft ? 0 : !state.consentGiven ? 1 : state.readySources === 0 ? 2 : lastStep;
}

/** The upload phase a source row shows. Working statuses map 1:1; an error uses its recorded reason. */
export function phaseOf(s: Pick<DraftSource, "status" | "errorPhase" | "needsDateOrder">): UploadPhase {
  if (s.status !== "error") return s.status;
  if (s.needsDateOrder) return "needs_input";
  return s.errorPhase ?? "failed";
}

/** Size message shared by the local check and the server's `too_large` verdict. */
export const TOO_LARGE_MESSAGE = "Files can be up to 25 MB. Export the chat without media, or split the document.";

/**
 * What a failed `confirmSourceUploaded` means for the row (QA-R3-16). `validation_failed` covers
 * several server checks, told apart by `details.reason`: only `kind_mismatch` says the bytes aren't this
 * kind of file; `integrity_mismatch` (size or SHA-256 differs) is a damaged upload worth retrying;
 * `too_large` is the size limit. An unknown reason never blames the file type.
 */
export function confirmFailure(
  error: { code: string; retryable?: boolean; details?: Record<string, unknown> } | null,
  file: { kindNoun: string; textHint?: string },
): { message: string; phase: "failed" | "unsupported" | "too_large" } {
  if (error?.code === "validation_failed") {
    const reason = typeof error.details?.reason === "string" ? error.details.reason : undefined;
    if (reason === "kind_mismatch") return { phase: "unsupported", message: `This file isn't a valid ${file.kindNoun}. Choose the right file.${file.textHint ?? ""}` };
    if (reason === "too_large") return { phase: "too_large", message: TOO_LARGE_MESSAGE };
    if (reason === "integrity_mismatch") return { phase: "failed", message: "The upload didn't arrive intact. Retry the upload." };
    return { phase: "failed", message: "Baton couldn't verify this upload. Retry the upload." };
  }
  const transient = !error || !!error.retryable || error.code === "internal";
  return {
    phase: "failed",
    message: transient ? "Baton couldn't confirm the upload. Check your connection and retry." : "The uploaded file didn't match what was sent. Retry the upload.",
  };
}
