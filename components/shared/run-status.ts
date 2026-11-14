/**
 * How processing stages and run failure reasons read to people (processing view).
 * Pure and React-free (components/shared/__tests__/run-status.test.ts).
 */

import type { RunStatus } from "@/lib/contracts/enums";

export type StageStatus = RunStatus | "partial";
export type StageTone = "done" | "active" | "idle" | "warning" | "danger";

export interface StageStatusMeta {
  /** Spoken/visible status, e.g. "Partly done: some sources were skipped or failed". */
  label: string;
  tone: StageTone;
}

export function stageStatusMeta(status: StageStatus): StageStatusMeta {
  switch (status) {
    case "succeeded":
      return { label: "Done", tone: "done" };
    case "running":
      return { label: "In progress", tone: "active" };
    case "partial":
      return { label: "Partly done: some sources were skipped or failed", tone: "warning" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "idle" };
    default:
      return { label: "Waiting", tone: "idle" };
  }
}

/** Plain-language copy for run reason tokens. Unknown tokens get a generic line plus the reference. */
const REASONS: Record<string, string> = {
  db_schema_outdated: "Baton's database needs an update before processing can run. Ask the workspace admin.",
  no_jobs: "There was nothing to process: no source was ready when the run started. Check that each source finished uploading, then try again.",
  provider_not_configured: "Baton's AI provider isn't set up for this workspace yet. Ask the workspace admin.",
  ai_config_changed: "Baton's AI settings changed while this run was going. Start processing again.",
  // Structural run outcomes (lib/pipeline/finish.ts).
  no_source_succeeded: "None of your sources could be read. Check each source on the right, then try again.",
  verify_support_failed: "Baton read your sources but couldn't finish checking the points against their quotes. Try again.",
  analyze_failed: "Baton read your sources but couldn't finish looking for knowledge gaps. Try again.",
  prepare_review_failed: "Baton read your sources but couldn't finish preparing the review. Try again.",
  // AI call failures, surfaced as the run reason by lib/pipeline/finish.ts (RUN_SURFACED_AI_REASONS).
  ai_provider_error:
    "The AI provider couldn't complete the request. It may be busy or over its free-tier limit, or the AI key or model may not be valid. Wait a few minutes and try again; if it keeps failing, ask the workspace admin to check the AI settings.",
  ai_transient: "The AI provider had a temporary problem and Baton ran out of retries. Wait a few minutes and try again.",
  ai_timed_out: "The AI provider took too long to answer, even after retries. Wait a few minutes and try again.",
  ai_aborted: "The AI request was cancelled before it finished. Try again.",
  ai_invalid_output: "The AI returned an answer Baton couldn't use, even after retrying. Try again; if it keeps happening, ask the workspace admin.",
  ai_tool_call: "The AI returned an answer Baton couldn't use, even after retrying. Try again; if it keeps happening, ask the workspace admin.",
  ai_request_invalid: "The AI provider rejected Baton's request as invalid. Ask the workspace admin to check the AI model settings.",
  ai_request_too_large: "Part of a source was too large to send to the AI in one request. Try a shorter export or a narrower date range.",
  ai_budget_exceeded: "These sources are larger than Baton can process in one run. Try a shorter export or a narrower date range.",
};

const TOKEN = /^[a-z][a-z0-9_]*(:[a-z0-9_]+)?$/;

/** User-facing text for a run error: mapped token, generic text for other tokens, or the server message. */
export function runReasonText(message: string | null | undefined): { text: string; reference: string | null } {
  if (!message) return { text: "Something went wrong while reading your sources.", reference: null };
  const known = REASONS[message];
  if (known) return { text: known, reference: message };
  if (TOKEN.test(message)) return { text: "Processing stopped before it finished.", reference: message };
  return { text: message, reference: null };
}
