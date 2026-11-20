/**
 * What the processing page offers below the run (2026-11-20, Round 4 Telegram import regression). Pure and
 * React-free so the rules are testable (components/processing/__tests__/processing-controls.test.ts).
 *
 * The regression: after a succeeded run, the start section was shown only for pending source UPDATES (version 2+).
 * A source ADDED during review (a first version, e.g. a connector's chat_import) has no update state, so the page
 * said "Processing complete" and hid the consent checklist while the sidebar said "Consent needed".
 *
 * Rules:
 *  - A current first-version source that is not parsed yet, or has no consent recorded, is a NEW source waiting for
 *    processing; it keeps the start section (and its mandatory consent checklist) visible after a succeeded run.
 *  - Start stays disabled until every consent statement is ticked whenever any source needs consent.
 *  - The button names what will happen; "Try again" only after a failed or cancelled run.
 */

import type { HandoverState, RunStatus, SourceState } from "@/lib/contracts/enums";

export interface ControlSource {
  state: SourceState;
  consentRecordedAt: string | null;
  version?: { versionNumber: number | null; updateState?: string | null } | null;
}

const PENDING_UPDATE_STATES = new Set(["awaiting_processing", "failed", "awaiting_detection"]);

/** A version 2+ whose processing or change check is still due (mirrors the processing view's pendingUpdates). */
export function isPendingUpdate(s: ControlSource): boolean {
  return (s.version?.versionNumber ?? 1) > 1 && PENDING_UPDATE_STATES.has(s.version?.updateState ?? "");
}

/**
 * Current sources added since the last succeeded run that still need processing: first versions (no update state)
 * that are not parsed yet or have no consent recorded. Pass only CURRENT versions (isCurrentSourceVersion).
 */
export function newSourcesAwaitingProcessing<S extends ControlSource>(sources: readonly S[], runStatus: RunStatus | null): S[] {
  if (runStatus !== "succeeded") return [];
  return sources.filter((s) => !((s.version?.versionNumber ?? 1) > 1 && s.version?.updateState) && (s.state !== "parsed" || !s.consentRecordedAt));
}

export type StartLabel =
  | "Process the new version"
  | "Process the new versions"
  | "Process the new source"
  | "Process the new sources"
  | "Process the new sources and versions"
  | "Try again"
  | "Start processing";

export interface ControlsInput {
  active: boolean;
  canStart: boolean;
  handoverState: HandoverState;
  runStatus: RunStatus | null;
  /** Current source versions only. */
  sourceCount: number;
  pendingUpdates: number;
  newSources: number;
  needsConsent: number;
  consentComplete: boolean;
  isPending: boolean;
}

export interface Controls {
  /** The start section (consent checklist + button). */
  showStart: boolean;
  /** The consent checklist inside it (mandatory whenever a source has no consent). */
  showConsent: boolean;
  startDisabled: boolean;
  label: StartLabel;
}

export function processingControls(i: ControlsInput): Controls {
  const editable = i.handoverState === "draft" || i.handoverState === "in_review";
  const somethingToProcess = i.runStatus !== "succeeded" || i.pendingUpdates > 0 || i.newSources > 0 || i.needsConsent > 0;
  const showStart = !i.active && i.canStart && editable && somethingToProcess;
  const startDisabled = i.isPending || i.sourceCount === 0 || (i.needsConsent > 0 && !i.consentComplete);
  return { showStart, showConsent: showStart && i.needsConsent > 0, startDisabled, label: startLabel(i) };
}

function startLabel(i: ControlsInput): StartLabel {
  if (i.runStatus === "succeeded" && i.newSources > 0) {
    if (i.pendingUpdates > 0) return "Process the new sources and versions";
    return i.newSources === 1 ? "Process the new source" : "Process the new sources";
  }
  if (i.pendingUpdates > 0 && i.handoverState === "in_review") return i.pendingUpdates === 1 ? "Process the new version" : "Process the new versions";
  if (i.runStatus === "failed" || i.runStatus === "cancelled") return "Try again";
  return "Start processing";
}
