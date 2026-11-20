import "server-only";

/**
 * Raw-upload retention sweep (Round 3 Task 02, PRIV-2; docs/architecture/proposals/retention.md §7, migration
 * 20261117200200). The OWNER decides when it runs and how: nothing deletes anything until
 * BATON_RETENTION_MODE=live is set on the deployment (default: off).
 *
 *   off      the endpoint answers {mode: "off"} and touches nothing.
 *   dry_run  the inventory only: what the policy would clean now, protected sources, items awaiting retry.
 *            Nothing is claimed, changed or deleted. Recorded as a dry-run row.
 *   live     1. claim eligible, unprotected sources (row change + path moved to raw_retention_items, under
 *               locks in SQL: a run can no longer start on them);
 *            2. delete each due item's object through Supabase Storage with the service role (idempotent),
 *               after checking the path is exactly raw/{handover}/{source} of that item;
 *            3. record each outcome ('deleted' or 'failed' with a class: retried with backoff, visible in the
 *               report), then one run row.
 *
 * Never deletes database content (normalized messages, points, publications) and never calls the purge.
 * Logs and the response hold counts only: no paths, names, titles or content.
 */

import type { DbClient } from "../db/client";
import { callRpc } from "../db/rpc";
import { rawSourcePath, SOURCE_BUCKET, type StorageClient } from "../db/storage";
import type { PipelineLogger } from "../pipeline/log";

export const RETENTION_MODES = ["off", "dry_run", "live"] as const;
export type RetentionMode = (typeof RETENTION_MODES)[number];

export interface RetentionPolicy {
  /** pending_upload rows and failed post-parse deletes are cleaned after this (hours, ≥ 2). */
  pendingGraceHours: number;
  /** uploaded-but-unprocessed and failed-parse raw uploads are deleted after this (days). Proposal: 7. */
  rawCeilingDays: number;
  /** At most this many claims and this many deletes per run. */
  maxPerRun: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = { pendingGraceHours: 24, rawCeilingDays: 7, maxPerRun: 100 };

function intIn(value: string | undefined, min: number, max: number, fallback: number): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= min && n <= max ? n : null;
}

/**
 * The deployment's retention configuration. Any invalid value turns the sweep OFF (fail closed: a typo can
 * never shorten the retention period or start deleting).
 */
export function retentionConfig(env: Record<string, string | undefined> = process.env):
  | { mode: RetentionMode; policy: RetentionPolicy }
  | { mode: "off"; invalid: string } {
  const rawMode = (env.BATON_RETENTION_MODE ?? "").trim();
  const mode = rawMode === "" ? "off" : rawMode;
  if (!(RETENTION_MODES as readonly string[]).includes(mode)) return { mode: "off", invalid: "BATON_RETENTION_MODE" };
  const rawCeilingDays = intIn(env.BATON_RAW_RETENTION_DAYS, 1, 365, DEFAULT_RETENTION_POLICY.rawCeilingDays);
  if (rawCeilingDays === null) return { mode: "off", invalid: "BATON_RAW_RETENTION_DAYS" };
  const pendingGraceHours = intIn(env.BATON_PENDING_UPLOAD_GRACE_HOURS, 2, 168, DEFAULT_RETENTION_POLICY.pendingGraceHours);
  if (pendingGraceHours === null) return { mode: "off", invalid: "BATON_PENDING_UPLOAD_GRACE_HOURS" };
  const maxPerRun = intIn(env.BATON_RETENTION_MAX_PER_RUN, 1, 1000, DEFAULT_RETENTION_POLICY.maxPerRun);
  if (maxPerRun === null) return { mode: "off", invalid: "BATON_RETENTION_MAX_PER_RUN" };
  return { mode: mode as RetentionMode, policy: { pendingGraceHours, rawCeilingDays, maxPerRun } };
}

export interface RetentionReport {
  mode: "dry_run" | "live";
  eligible: number;
  protected: number;
  byReason: Record<string, number>;
  claimed: number;
  claimSkipped: number;
  deleted: number;
  failed: number;
  /** Items that were due for a (re)try at the start of this run. */
  due: number;
}

interface InventoryCandidate {
  sourceId: string;
  handoverId: string;
  reason: string;
  protected: boolean;
}

interface DueItem {
  sourceId: string;
  handoverId: string;
  path: string;
  reason: string;
  attempts: number;
}

export interface RetentionDeps {
  db: DbClient;
  storage: StorageClient;
  logger: PipelineLogger;
  now?: () => number;
}

const intervals = (p: RetentionPolicy) => ({
  p_pending_grace: `${p.pendingGraceHours} hours`,
  p_raw_ceiling: `${p.rawCeilingDays} days`,
});

export async function runRetentionSweep(
  deps: RetentionDeps,
  opts: { mode: "dry_run" | "live"; policy: RetentionPolicy; trigger: "pg_cron" | "vercel_schedule" | "manual" | "other"; deadlineMs?: number },
): Promise<RetentionReport> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (opts.deadlineMs ?? 120_000);
  const policy = opts.policy;

  const inventory = (await callRpc(deps.db, "raw_retention_inventory", { ...intervals(policy), p_limit: policy.maxPerRun })) as {
    eligible: number;
    protected: number;
    byReason: Record<string, number>;
    candidates: InventoryCandidate[];
  };
  const due = (await callRpc(deps.db, "due_raw_retention_items", { p_limit: policy.maxPerRun })) as DueItem[];
  const report: RetentionReport = {
    mode: opts.mode,
    eligible: Number(inventory.eligible) || 0,
    protected: Number(inventory.protected) || 0,
    byReason: { ...(inventory.byReason ?? {}) },
    claimed: 0,
    claimSkipped: 0,
    deleted: 0,
    failed: 0,
    due: Array.isArray(due) ? due.length : 0,
  };

  if (opts.mode === "live") {
    for (const c of inventory.candidates ?? []) {
      if (c.protected || report.claimed >= policy.maxPerRun || now() > deadline) continue;
      const r = (await callRpc(deps.db, "claim_raw_for_retention", { p_source_id: c.sourceId, ...intervals(policy) })) as { claimed?: boolean };
      if (r?.claimed === true) report.claimed += 1;
      else report.claimSkipped += 1;
    }
    // Everything due now: what was just claimed plus failed items whose backoff has passed.
    const work = (await callRpc(deps.db, "due_raw_retention_items", { p_limit: policy.maxPerRun })) as DueItem[];
    for (const item of work ?? []) {
      if (now() > deadline) break;
      // Exactly raw/{handover}/{source} of this item (stricter than isOwnedRawPath, which tolerates test
      // placeholders); the SQL claim enforces the same rule.
      if (typeof item.path !== "string" || item.path.toLowerCase() !== rawSourcePath(item.handoverId, item.sourceId).toLowerCase()) {
        await callRpc(deps.db, "complete_raw_retention_item", { p_source_id: item.sourceId, p_outcome: "failed", p_error: "path_refused" });
        report.failed += 1;
        continue;
      }
      let ok = false;
      try {
        const { error } = await deps.storage.from(SOURCE_BUCKET).remove([item.path]);
        ok = !error;
      } catch {
        ok = false;
      }
      await callRpc(deps.db, "complete_raw_retention_item", {
        p_source_id: item.sourceId,
        p_outcome: ok ? "deleted" : "failed",
        p_error: ok ? null : "storage_error",
      });
      if (ok) report.deleted += 1;
      else report.failed += 1;
    }
  }

  await callRpc(deps.db, "record_raw_retention_run", {
    p_mode: opts.mode,
    p_trigger: opts.trigger,
    p_started_at: new Date(startedAt).toISOString(),
    p_policy: { ...policy },
    p_counts: { ...report, byReason: { ...report.byReason } },
  });
  const { byReason, ...counts } = report;
  const fields = {
    trigger: opts.trigger,
    durationMs: now() - startedAt,
    ...counts,
    ...Object.fromEntries(Object.entries(byReason).map(([k, v]) => [`reason_${k}`, Number(v) || 0])),
  };
  if (report.failed > 0) deps.logger.warn("retention_sweep_finished", fields);
  else deps.logger.info("retention_sweep_finished", fields);
  return report;
}
