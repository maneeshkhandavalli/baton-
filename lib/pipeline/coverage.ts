/**
 * Coverage and signal persistence for the pipeline (R3 Task 03, EXT-1/2/3, VER-2/3).
 *
 * These writes report on processing; they never decide it. So:
 *   - a database without migration 20261117300100 (PipelineSchemaError) makes them no-ops for the rest of
 *     the job, logged once as `coverage_unavailable`, and the report then says "coverage unavailable"
 *     instead of pretending the run was fully covered;
 *   - every other error propagates unchanged, in particular ClaimLostError (DB-12 fencing), so a stale
 *     worker still stops at once.
 */

import { PipelineSchemaError, storePointFlags, storeSourceSignals, type NewPointFlag, type SourceSignalCoverage } from "../db/pipeline";
import { scanSourceSignals, type SignalMessage } from "../signals/detect";
import { claimOf, type StageContext } from "./stage-context";

/** Signals per write call (the SQL refuses more than 5000). */
export const SIGNAL_BATCH = 1000;
export const FLAG_BATCH = 1000;

export class CoverageWriter {
  private available = true;
  private readonly ctx: StageContext;
  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** Runs `write`; returns false (and stops trying) when the database lacks the coverage functions. */
  async run(write: () => Promise<unknown>): Promise<boolean> {
    if (!this.available) return false;
    try {
      await write();
      return true;
    } catch (e) {
      if (!(e instanceof PipelineSchemaError)) throw e;
      this.available = false;
      this.ctx.logger.warn("coverage_unavailable", { jobId: this.ctx.claimed.id, fn: e.fn });
      return false;
    }
  }
}

export interface SignalScanResult {
  messagesInspected: number;
  messagesWithSignals: number;
  signals: number;
  stored: boolean;
}

/**
 * Scans one source's persisted (masked, pseudonymised) text messages and stores the coverage row and the
 * signals. Deterministic, provider-independent, and run before any AI call, so a source whose extraction
 * later fails still shows what it contained.
 */
export async function scanAndStoreSignals(
  ctx: StageContext,
  writer: CoverageWriter,
  messages: readonly SignalMessage[],
  plan: { oversizeSkipped: number; emptySkipped: number; chunksTotal: number },
): Promise<SignalScanResult> {
  const scan = scanSourceSignals(messages);
  const coverage: SourceSignalCoverage = {
    detectorVersion: scan.detectorVersion,
    messagesInspected: scan.messagesInspected,
    messagesWithSignals: scan.messagesWithSignals,
    signals: scan.signals.length,
    oversizeSkipped: plan.oversizeSkipped,
    emptySkipped: plan.emptySkipped,
    chunksTotal: plan.chunksTotal,
  };
  let stored = true;
  const signals = scan.signals.map((s) => ({ messageId: s.messageId, kind: s.kind, strength: s.strength, start: s.start, end: s.end, value: s.value }));
  // The coverage row is written with the first batch (or alone when there are no signals).
  for (let i = 0; i === 0 || i < signals.length; i += SIGNAL_BATCH) {
    const batch = signals.slice(i, i + SIGNAL_BATCH);
    stored = (await writer.run(() => storeSourceSignals(ctx.db, claimOf(ctx), { coverage, signals: batch }))) && stored;
    if (!stored) break;
  }
  return { messagesInspected: scan.messagesInspected, messagesWithSignals: scan.messagesWithSignals, signals: signals.length, stored };
}

export async function storeFlagsInBatches(ctx: StageContext, writer: CoverageWriter, flags: NewPointFlag[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < flags.length; i += FLAG_BATCH) {
    const batch = flags.slice(i, i + FLAG_BATCH);
    let n = 0;
    if (!(await writer.run(async () => (n = await storePointFlags(ctx.db, claimOf(ctx), batch))))) break;
    inserted += n;
  }
  return inserted;
}
