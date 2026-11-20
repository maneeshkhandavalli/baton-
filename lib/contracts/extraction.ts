/**
 * Extraction coverage and review-flag contracts (R3 Task 03: EXT-1, EXT-2, EXT-3, VER-2, VER-3).
 *
 * `ExtractionReport` answers "how much of each source did Baton actually look at, what did it find, what
 * did it throw away and what still needs a person". It is built from counts only (never message text) by
 * `buildExtractionReport`, which is pure so the database mapper, the mocks and the tests share it.
 */

export const SOURCE_EXTRACTION_STATES = [
  /** No extract job for this source in the latest run. */
  "not_processed",
  /** The extract job is queued or running. */
  "in_progress",
  /** Every chunk was analysed and no message was skipped. */
  "complete",
  /** Every chunk was analysed, but some messages were too long to send and were skipped. */
  "complete_with_skips",
  /** Some chunks were analysed, then the job failed or was cancelled. */
  "partial",
  /** The job failed before any chunk was analysed. */
  "failed",
] as const;
export type SourceExtractionState = (typeof SOURCE_EXTRACTION_STATES)[number];

/**
 * Run-level headline. `in_progress` while the run is queued or running (even when every extract job is done:
 * later stages can still fail or change coverage). `complete` only when every processed source is complete AND
 * its coverage was recorded. `unrecorded` (audit 4.8): every source finished, but at least one has no recorded
 * coverage, so Baton cannot say it was fully analysed (and never shows those missing counts as zero coverage).
 */
export const RUN_EXTRACTION_COMPLETIONS = ["none", "in_progress", "complete", "partial", "failed", "unrecorded"] as const;
export type RunExtractionCompletion = (typeof RUN_EXTRACTION_COMPLETIONS)[number];

export const EXTRACTION_BLOCKERS = [
  "source_partially_extracted",
  "source_extraction_failed",
  "oversize_messages_skipped",
  "candidates_discarded",
  "unreviewed_signals",
  "possible_contradictions",
  "unresolved_attribution",
  "coverage_unavailable",
] as const;
export type ExtractionBlockerKind = (typeof EXTRACTION_BLOCKERS)[number];

/**
 * `blocking`: publishing requires an explicit acknowledgement (the reviewer accepts that part of a source
 * was never analysed). `advisory`: shown, never required.
 */
export type ExtractionBlockerSeverity = "blocking" | "advisory";

export interface ExtractionBlocker {
  kind: ExtractionBlockerKind;
  severity: ExtractionBlockerSeverity;
  count: number;
  sourceIds: string[];
}

export interface SourceExtractionCoverage {
  sourceId: string;
  title: string | null;
  state: SourceExtractionState;
  /** The extract job's reason token when it failed (e.g. `ai_quota_exhausted`); never content. */
  failureReason: string | null;
  chunksDone: number;
  chunksTotal: number;
  /** chunksDone / chunksTotal (1 when the source had nothing to analyse). */
  chunkCompleteness: number;
  /** False when this run wrote no coverage record (older run, or a database without the migration). */
  coverageRecorded: boolean;
  messagesInspected: number;
  messagesWithSignals: number;
  oversizeSkipped: number;
  emptySkipped: number;
  signals: number;
  /** Signal-bearing messages cited by a live point's evidence. */
  signalMessagesLinked: number;
  /** Signal-bearing messages a reviewer marked as not relevant. */
  signalMessagesDismissed: number;
  /** Signal-bearing messages nobody has looked at: not cited, not dismissed. */
  signalMessagesUnreviewed: number;
  candidatesReturned: number;
  candidatesDiscarded: number;
  /** Discards by reason token (model-output checks, identity guard, unsupported). Counts only. */
  discardedByReason: Record<string, number>;
  pointsCreated: number;
  pointsMerged: number;
  /**
   * R3 Task 04: the database's own publish-gate view (migration 20261117400200), null on older databases.
   * `partial` / `failed` need an acknowledgement for exactly `coverageFingerprint` before publishing.
   */
  gapState: "complete" | "partial" | "failed" | "in_progress" | "not_processed" | null;
  coverageFingerprint: string | null;
  gapAcknowledged: boolean;
}

export interface ExtractionReport {
  /** False when the database has no coverage support (migration not applied): nothing below is meaningful. */
  available: boolean;
  runId: string | null;
  runStatus: string | null;
  completion: RunExtractionCompletion;
  sources: SourceExtractionCoverage[];
  totals: {
    messagesInspected: number;
    messagesWithSignals: number;
    signalMessagesLinked: number;
    signalMessagesUnreviewed: number;
    candidatesDiscarded: number;
    oversizeSkipped: number;
    chunksDone: number;
    chunksTotal: number;
  };
  flags: { possibleContradictions: number; unresolvedAttribution: number; inferredAttribution: number };
  blockers: ExtractionBlocker[];
  /** R3 Task 05C: updates of current source versions (empty on an older database). */
  sourceUpdates: SourceUpdateStatus[];
}

/**
 * R3 Task 05C: where a new version of a source stands. `awaiting_detection` is processed but not yet compared with
 * the handover (Task 05D), so it is not "ready". `blocksPublication` is the database's own rule
 * (source_update_blocks_publication); it cannot be acknowledged away. A `failed` update with an extraction gap
 * does not block here: it goes through the extraction acknowledgement instead and stays `failed`.
 */
export const SOURCE_UPDATE_STATES = ["awaiting_processing", "processing", "awaiting_detection", "ready", "failed", "superseded"] as const;
export type SourceUpdateState = (typeof SOURCE_UPDATE_STATES)[number];

export interface SourceUpdateStatus {
  sourceId: string;
  previousSourceId: string;
  title: string | null;
  fromVersion: number;
  toVersion: number;
  state: SourceUpdateState;
  errorCode: string | null;
  blocksPublication: boolean;
  /** R3 Task 05D: open (or investigating) change-review items found in this update (0 on an older database). */
  openReviewItems: number;
}

export interface RawSourceUpdate {
  sourceId?: string;
  previousSourceId?: string;
  title?: string | null;
  fromVersion?: number;
  toVersion?: number;
  state?: string;
  errorCode?: string | null;
  blocksPublication?: boolean;
  openReviewItems?: number;
}

// ── Raw shape returned by api_get_extraction_report ──────────────────────────

export interface RawSourceCoverage {
  sourceId: string;
  title?: string | null;
  jobStatus?: string | null;
  jobError?: string | null;
  chunksDone?: number | null;
  chunksTotal?: number | null;
  coverageRecorded?: boolean;
  messagesInspected?: number | null;
  messagesWithSignals?: number | null;
  oversizeSkipped?: number | null;
  emptySkipped?: number | null;
  signals?: number | null;
  signalMessagesLinked?: number | null;
  signalMessagesDismissed?: number | null;
  signalMessagesUnreviewed?: number | null;
  candidatesReturned?: number | null;
  discarded?: Record<string, unknown> | null;
  pointsCreated?: number | null;
  pointsMerged?: number | null;
  gapState?: string | null;
  coverageFingerprint?: string | null;
  gapAcknowledged?: boolean | null;
}

export interface RawExtractionReport {
  available?: boolean;
  runId?: string | null;
  runStatus?: string | null;
  sources?: RawSourceCoverage[] | null;
  flags?: { possibleContradictions?: number; unresolvedAttribution?: number; inferredAttribution?: number } | null;
  sourceUpdates?: RawSourceUpdate[] | null;
}

const GAP_STATES: ReadonlySet<string> = new Set(["complete", "partial", "failed", "in_progress", "not_processed"]);
const FINGERPRINT = /^cov1:[0-9a-f]{32}$/;

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function sourceExtractionState(r: RawSourceCoverage): SourceExtractionState {
  const done = n(r.chunksDone);
  const total = n(r.chunksTotal);
  switch (r.jobStatus) {
    case null:
    case undefined:
      return "not_processed";
    case "queued":
    case "running":
      return "in_progress";
    case "succeeded":
      if (total > 0 && done < total) return "partial";
      return n(r.oversizeSkipped) > 0 ? "complete_with_skips" : "complete";
    default: // failed, cancelled, skipped
      return done > 0 ? "partial" : "failed";
  }
}

function discards(raw: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (/^[a-z0-9_]{1,64}$/.test(k) && n(v) > 0) out[k] = n(v);
  }
  return out;
}

export function buildExtractionReport(raw: RawExtractionReport | null | undefined): ExtractionReport {
  const available = raw?.available === true;
  const sources: SourceExtractionCoverage[] = (raw?.sources ?? []).map((r) => {
    const discardedByReason = discards(r.discarded);
    const total = n(r.chunksTotal);
    const done = Math.min(n(r.chunksDone), total || n(r.chunksDone));
    const state = sourceExtractionState(r);
    return {
      sourceId: r.sourceId,
      title: r.title ?? null,
      state,
      failureReason: state === "partial" || state === "failed" ? (r.jobError ?? null) : null,
      chunksDone: done,
      chunksTotal: total,
      chunkCompleteness: total === 0 ? (state === "complete" || state === "complete_with_skips" ? 1 : 0) : done / total,
      coverageRecorded: r.coverageRecorded === true,
      messagesInspected: n(r.messagesInspected),
      messagesWithSignals: n(r.messagesWithSignals),
      oversizeSkipped: n(r.oversizeSkipped),
      emptySkipped: n(r.emptySkipped),
      signals: n(r.signals),
      signalMessagesLinked: n(r.signalMessagesLinked),
      signalMessagesDismissed: n(r.signalMessagesDismissed),
      signalMessagesUnreviewed: n(r.signalMessagesUnreviewed),
      candidatesReturned: n(r.candidatesReturned),
      // `citations_*` keys count removed citations, not discarded candidates.
      candidatesDiscarded: Object.entries(discardedByReason).reduce((a, [k, v]) => (k.startsWith("citations_") ? a : a + v), 0),
      discardedByReason,
      pointsCreated: n(r.pointsCreated),
      pointsMerged: n(r.pointsMerged),
      gapState: GAP_STATES.has(r.gapState ?? "") ? (r.gapState as SourceExtractionCoverage["gapState"]) : null,
      coverageFingerprint: typeof r.coverageFingerprint === "string" && FINGERPRINT.test(r.coverageFingerprint) ? r.coverageFingerprint : null,
      gapAcknowledged: r.gapAcknowledged === true,
    };
  });

  const sum = (f: (s: SourceExtractionCoverage) => number) => sources.reduce((a, s) => a + f(s), 0);
  const flags = {
    possibleContradictions: n(raw?.flags?.possibleContradictions),
    unresolvedAttribution: n(raw?.flags?.unresolvedAttribution),
    inferredAttribution: n(raw?.flags?.inferredAttribution),
  };

  const processed = sources.filter((s) => s.state !== "not_processed");
  const runActive = raw?.runStatus === "queued" || raw?.runStatus === "running";
  let completion: RunExtractionCompletion;
  if (processed.length === 0) completion = runActive ? "in_progress" : "none";
  else if (runActive || processed.some((s) => s.state === "in_progress")) completion = "in_progress";
  else if (processed.every((s) => s.state === "failed")) completion = "failed";
  else if (processed.some((s) => s.state === "partial" || s.state === "failed" || s.state === "complete_with_skips")) completion = "partial";
  else if (processed.every((s) => s.coverageRecorded)) completion = "complete";
  else completion = "unrecorded";

  const blockers: ExtractionBlocker[] = [];
  const add = (kind: ExtractionBlockerKind, severity: ExtractionBlockerSeverity, list: SourceExtractionCoverage[], count: number) => {
    if (count > 0) blockers.push({ kind, severity, count, sourceIds: list.map((s) => s.sourceId) });
  };
  if (available) {
    const partial = sources.filter((s) => s.state === "partial");
    const failed = sources.filter((s) => s.state === "failed");
    const skipped = sources.filter((s) => s.oversizeSkipped > 0);
    const discarded = sources.filter((s) => s.candidatesDiscarded > 0);
    const unreviewed = sources.filter((s) => s.signalMessagesUnreviewed > 0);
    const unrecorded = processed.filter((s) => !s.coverageRecorded && s.state !== "in_progress");
    if (sources.some((s) => s.gapState !== null)) {
      // R3 Task 04: the database enforces the gate; block on exactly its unacknowledged partial/failed sources.
      const dbPartial = sources.filter((s) => s.gapState === "partial" && !s.gapAcknowledged);
      const dbFailed = sources.filter((s) => s.gapState === "failed" && !s.gapAcknowledged);
      add("source_partially_extracted", "blocking", dbPartial, dbPartial.length);
      add("source_extraction_failed", "blocking", dbFailed, dbFailed.length);
    } else {
      add("source_partially_extracted", "blocking", partial, partial.length);
      // A failed source matters only when the run went ahead without it (another source succeeded).
      if (completion !== "failed") add("source_extraction_failed", "blocking", failed, failed.length);
    }
    add("oversize_messages_skipped", "advisory", skipped, sum((s) => s.oversizeSkipped));
    add("candidates_discarded", "advisory", discarded, sum((s) => s.candidatesDiscarded));
    add("unreviewed_signals", "advisory", unreviewed, sum((s) => s.signalMessagesUnreviewed));
    add("possible_contradictions", "advisory", [], flags.possibleContradictions);
    add("unresolved_attribution", "advisory", [], flags.unresolvedAttribution);
    add("coverage_unavailable", "advisory", unrecorded, unrecorded.length);
  }

  return {
    available,
    runId: raw?.runId ?? null,
    runStatus: raw?.runStatus ?? null,
    completion,
    sources,
    totals: {
      messagesInspected: sum((s) => s.messagesInspected),
      messagesWithSignals: sum((s) => s.messagesWithSignals),
      signalMessagesLinked: sum((s) => s.signalMessagesLinked),
      signalMessagesUnreviewed: sum((s) => s.signalMessagesUnreviewed),
      candidatesDiscarded: sum((s) => s.candidatesDiscarded),
      oversizeSkipped: sum((s) => s.oversizeSkipped),
      chunksDone: sum((s) => s.chunksDone),
      chunksTotal: sum((s) => s.chunksTotal),
    },
    flags,
    blockers,
    sourceUpdates: available ? sourceUpdatesOf(raw?.sourceUpdates) : [],
  };
}

const UPDATE_STATES: ReadonlySet<string> = new Set(SOURCE_UPDATE_STATES);

function sourceUpdatesOf(raw: RawSourceUpdate[] | null | undefined): SourceUpdateStatus[] {
  return (raw ?? []).flatMap((u) =>
    typeof u.sourceId === "string" && typeof u.previousSourceId === "string" && UPDATE_STATES.has(u.state ?? "")
      ? [
          {
            sourceId: u.sourceId,
            previousSourceId: u.previousSourceId,
            title: u.title ?? null,
            fromVersion: n(u.fromVersion),
            toVersion: n(u.toVersion),
            state: u.state as SourceUpdateState,
            errorCode: typeof u.errorCode === "string" ? u.errorCode : null,
            // fail closed: anything but an explicit `false` from the database blocks
            blocksPublication: u.blocksPublication !== false,
            openReviewItems: n(u.openReviewItems),
          },
        ]
      : [],
  );
}

/** R3 Task 05C: source updates that keep the handover from being published (no acknowledgement can lift them). */
export function blockingSourceUpdates(report: ExtractionReport): SourceUpdateStatus[] {
  return report.available ? report.sourceUpdates.filter((u) => u.blocksPublication) : [];
}

/** A plain explanation of what the reviewer needs to do about one blocking update. */
export function sourceUpdateBlockText(u: SourceUpdateStatus): string {
  const name = u.title ?? "a source";
  switch (u.state) {
    case "awaiting_processing":
      return `Version ${u.toVersion} of ${name} hasn't been processed yet. Start processing to read it.`;
    case "processing":
      return `Version ${u.toVersion} of ${name} is being processed. Wait for it to finish.`;
    case "awaiting_detection":
      return `Version ${u.toVersion} of ${name} was processed, but Baton hasn't yet checked how it changes this handover. Process it again to run the check.`;
    case "ready":
      return u.openReviewItems > 0
        ? `Version ${u.toVersion} of ${name} changes this handover in ${u.openReviewItems} ${u.openReviewItems === 1 ? "place" : "places"} that ${u.openReviewItems === 1 ? "needs" : "need"} a decision.`
        : `Version ${u.toVersion} of ${name} was processed and checked.`;
    default:
      if (u.errorCode === "detection_incomplete") {
        return `Version ${u.toVersion} of ${name} was read, but the check of how it changes this handover didn't finish. Process it again.`;
      }
      if (u.openReviewItems > 0 && (u.errorCode === "extraction_partial" || u.errorCode === "extraction_failed")) {
        return `Version ${u.toVersion} of ${name} wasn't fully read, and ${u.openReviewItems} ${u.openReviewItems === 1 ? "change" : "changes"} found in it ${u.openReviewItems === 1 ? "needs" : "need"} a decision. Acknowledging the gap doesn't settle them.`;
      }
      return `Processing version ${u.toVersion} of ${name} didn't finish. Process it again.`;
  }
}

/**
 * R3 Task 05D: source updates that are not fully evaluated and settled: anything but `ready` with no open review
 * item. While any exists, nothing may claim that every source was fully analysed.
 */
export function unsettledSourceUpdates(report: ExtractionReport | null): SourceUpdateStatus[] {
  if (!report?.available) return [];
  return report.sourceUpdates.filter((u) => u.state !== "superseded" && !(u.state === "ready" && u.openReviewItems === 0));
}

/**
 * R3 Task 04: what the publish call must acknowledge, one entry per blocking source: its id and the exact coverage
 * fingerprint the reviewer saw. Empty on a database without the gate (no fingerprints).
 */
export function extractionAcknowledgements(report: ExtractionReport): Array<{ sourceId: string; fingerprint: string }> {
  const blocking = new Set(blockingExtractionGaps(report).flatMap((b) => b.sourceIds));
  return report.sources
    .filter((s) => blocking.has(s.sourceId) && s.coverageFingerprint !== null)
    .map((s) => ({ sourceId: s.sourceId, fingerprint: s.coverageFingerprint as string }));
}

/** Blocking extraction gaps that publishing must have acknowledged. */
export function blockingExtractionGaps(report: ExtractionReport): ExtractionBlocker[] {
  return report.available ? report.blockers.filter((b) => b.severity === "blocking") : [];
}

// ── Review flags (VER-2, VER-3) and unreviewed signals ───────────────────────

export const POINT_FLAG_KINDS = ["possible_contradiction", "attribution_unresolved", "attribution_inferred"] as const;
export type PointFlagKind = (typeof POINT_FLAG_KINDS)[number];
export const POINT_FLAG_STATES = ["open", "dismissed", "confirmed"] as const;
export type PointFlagState = (typeof POINT_FLAG_STATES)[number];

export interface PointReviewFlag {
  id: string;
  pointId: string;
  kind: PointFlagKind;
  state: PointFlagState;
  /** The later message that may contradict the point (possible_contradiction only). */
  sourceMessageId: string | null;
  /** Reason tokens (`reversal_marker`, `changed_date`, …) or the attribution field and status. Never text. */
  detail: { reasons?: string[]; score?: number; field?: string; status?: string };
  /** The flagged message's masked, pseudonymised text, when the viewer may read it. */
  messageExcerpt: string | null;
  messageSentAt: string | null;
}

export interface UnreviewedSignalMessage {
  sourceId: string;
  messageId: string;
  sentAt: string | null;
  authorLabel: string | null;
  /** The stored (masked, pseudonymised) message text. */
  body: string;
  signals: Array<{ kind: string; strength: "strong" | "weak"; start: number; end: number }>;
}
