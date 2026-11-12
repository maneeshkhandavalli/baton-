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
