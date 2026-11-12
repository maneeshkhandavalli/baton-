/**
 * Per-file upload phases and how each one looks (docs/design/design-system.md → Upload states).
 * Pure and React-free so it is unit-tested (components/shared/__tests__/upload-status.test.ts).
 * The wizard decides the phase; this module only names and classifies it.
 */

export type UploadPhase =
  | "queued"
  | "hashing"
  | "uploading"
  | "verifying"
  | "consent"
  | "previewing"
  | "ready"
  /** The file is fine but Baton needs an answer (e.g. day/month order). */
  | "needs_input"
  | "failed"
  | "duplicate"
  | "too_large"
  | "empty"
  | "unsupported";

export type UploadTone = "progress" | "success" | "warning" | "danger";

export interface UploadPhaseMeta {
  label: string;
  /** Default explanation; a specific server message may replace it. */
  description: string;
  tone: UploadTone;
  busy: boolean;
  /** The same file can be sent again (transient failure). */
  retryable: boolean;
}

/** The working phases in order; used for the "step n of 5" progress on a file row. */
export const UPLOAD_PIPELINE = ["hashing", "uploading", "verifying", "consent", "previewing"] as const satisfies readonly UploadPhase[];

export const uploadPhaseMeta: Record<UploadPhase, UploadPhaseMeta> = {
  queued: { label: "Waiting", description: "Starts when the files before it finish.", tone: "progress", busy: true, retryable: false },
  hashing: { label: "Checking file", description: "Reading the file on this device.", tone: "progress", busy: true, retryable: false },
  uploading: { label: "Uploading", description: "Sending to private storage.", tone: "progress", busy: true, retryable: false },
  verifying: { label: "Verifying", description: "Making sure the upload arrived intact.", tone: "progress", busy: true, retryable: false },
  consent: { label: "Recording consent", description: "Saving your consent for this file.", tone: "progress", busy: true, retryable: false },
  previewing: { label: "Reading preview", description: "Finding dates, people and conversations.", tone: "progress", busy: true, retryable: false },
  ready: { label: "Ready", description: "Uploaded, masked in preview and ready to scope.", tone: "success", busy: false, retryable: false },
  needs_input: { label: "Needs your answer", description: "Baton needs one detail before it can read this file.", tone: "warning", busy: false, retryable: false },
  failed: { label: "Upload failed", description: "The upload didn’t go through. Check your connection and retry.", tone: "danger", busy: false, retryable: true },
  duplicate: { label: "Already added", description: "This exact file is already in the handover.", tone: "warning", busy: false, retryable: false },
  too_large: { label: "Too large", description: "Files can be up to 25 MB. Export without media or split the file.", tone: "danger", busy: false, retryable: false },
  empty: { label: "Empty file", description: "This file has no content.", tone: "danger", busy: false, retryable: false },
  unsupported: { label: "Not supported", description: "Use a WhatsApp export (.txt or .zip), PDF, DOCX or Markdown file.", tone: "danger", busy: false, retryable: false },
};

/** Position in the working pipeline (1-based) for busy phases, else null. */
export function uploadProgress(phase: UploadPhase): { step: number; total: number } | null {
  const i = (UPLOAD_PIPELINE as readonly UploadPhase[]).indexOf(phase);
  return i === -1 ? null : { step: i + 1, total: UPLOAD_PIPELINE.length };
}

/**
 * Classify a failed upload. Order matters: local size checks first (they never reach the
 * server), then typed server codes (`conflict` = same file already uploaded to this handover).
 */
export function phaseForError(input: { code?: string; parserCode?: string; sizeBytes?: number; maxBytes?: number }): UploadPhase {
  if (input.sizeBytes !== undefined && input.maxBytes !== undefined && input.sizeBytes > input.maxBytes) return "too_large";
  if (input.sizeBytes === 0) return "empty";
  if (input.code === "payload_too_large") return "too_large";
  if (input.code === "conflict") return "duplicate";
  if (input.parserCode === "date_format_ambiguous") return "needs_input";
  if (input.code === "unsupported_file_type" || input.parserCode === "unsupported_format") return "unsupported";
  return "failed";
}
