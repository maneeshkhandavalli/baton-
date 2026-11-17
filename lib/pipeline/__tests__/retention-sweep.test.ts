// R3 Task 02 (PRIV-2): the raw-upload retention sweep against a fake database that behaves like the SQL
// (claim moves the path into an item; complete records the outcome). Synthetic ids only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retentionConfig, runRetentionSweep, DEFAULT_RETENTION_POLICY } from "../../retention/sweep";
import { createMemoryLogger } from "../log";
import { fakeDb, fakeStorage, IDS } from "./fakes";

const H = IDS.handover;
const S1 = IDS.source;
const S2 = IDS.source2;
const S3 = "33333333-3333-4333-8333-333333333333";
const path = (s: string) => `raw/${H}/${s}`;

function world(opts: { protectedIds?: string[]; failRemove?: boolean; badPath?: string } = {}) {
  const candidates = [S1, S2, S3].map((sourceId) => ({
    sourceId,
    handoverId: H,
    reason: sourceId === S3 ? "parsed_raw_pending" : "raw_ceiling",
    protected: (opts.protectedIds ?? []).includes(sourceId),
  }));
  const items = new Map<string, { status: string; path: string; attempts: number }>();
  const db = fakeDb({
    // Like the SQL: a claimed source no longer has a raw path, so it is no longer a candidate.
    raw_retention_inventory: () => ({
      eligible: candidates.filter((c) => !c.protected && !items.has(c.sourceId)).length,
      protected: candidates.filter((c) => c.protected).length,
      byReason: { raw_ceiling: 2, parsed_raw_pending: 1 },
      candidates: candidates.filter((c) => !items.has(c.sourceId)),
    }),
    claim_raw_for_retention: (a: Record<string, unknown>) => {
      const c = candidates.find((x) => x.sourceId === a.p_source_id)!;
      if (c.protected) return { claimed: false, why: "protected" };
      items.set(c.sourceId, { status: "pending", path: c.sourceId === opts.badPath ? "raw/elsewhere/x" : path(c.sourceId), attempts: 0 });
      return { claimed: true, reason: c.reason, path: path(c.sourceId) };
    },
    due_raw_retention_items: () =>
      [...items.entries()].filter(([, i]) => i.status !== "deleted").map(([sourceId, i]) => ({ sourceId, handoverId: H, path: i.path, reason: "raw_ceiling", attempts: i.attempts })),
    complete_raw_retention_item: (a: Record<string, unknown>) => {
      const i = items.get(a.p_source_id as string)!;
      i.attempts += 1;
      i.status = a.p_outcome === "deleted" ? "deleted" : "failed";
      return i.status;
    },
    record_raw_retention_run: () => "run-id",
  });
  const { storage, removed } = fakeStorage(null, [], opts.failRemove ?? false);
  return { db, storage, removed, items };
}

const deps = (w: ReturnType<typeof world>) => ({ db: w.db.client, storage: w.storage, logger: createMemoryLogger() });

describe("retention sweep", () => {
  it("dry run: reports what would be cleaned and never claims or deletes anything", async () => {
    const w = world({ protectedIds: [S2] });
    const r = await runRetentionSweep(deps(w), { mode: "dry_run", policy: DEFAULT_RETENTION_POLICY, trigger: "manual" });
    assert.equal(r.eligible, 2);
    assert.equal(r.protected, 1);
    assert.equal(w.db.called("claim_raw_for_retention").length, 0);
    assert.equal(w.db.called("complete_raw_retention_item").length, 0);
    assert.equal(w.removed.length, 0);
    assert.equal(w.db.called("record_raw_retention_run")[0].args.p_mode, "dry_run");
  });

  it("live: claims unprotected sources, deletes their objects through Storage, records each outcome", async () => {
    const w = world({ protectedIds: [S2] });
    const r = await runRetentionSweep(deps(w), { mode: "live", policy: DEFAULT_RETENTION_POLICY, trigger: "pg_cron" });
    assert.deepEqual(w.db.called("claim_raw_for_retention").map((c) => c.args.p_source_id), [S1, S3], "protected sources are never claimed");
    assert.equal(w.db.called("claim_raw_for_retention")[0].args.p_raw_ceiling, "7 days");
    assert.deepEqual(w.removed, [[path(S1)], [path(S3)]]);
    assert.equal(r.deleted, 2);
    assert.equal(r.failed, 0);
    assert.ok([...w.items.values()].every((i) => i.status === "deleted"));
  });

  it("a failed storage delete is recorded as failed (retried later), and a second run retries it idempotently", async () => {
    const w = world({ failRemove: true });
    const first = await runRetentionSweep(deps(w), { mode: "live", policy: DEFAULT_RETENTION_POLICY, trigger: "pg_cron" });
    assert.equal(first.failed, 3);
    assert.deepEqual(w.db.called("complete_raw_retention_item").map((c) => c.args.p_error), ["storage_error", "storage_error", "storage_error"]);
    // Storage recovers: the same items are retried and deleted; nothing is claimed twice.
    const ok = world();
    const retry = await runRetentionSweep(
      { db: w.db.client, storage: ok.storage, logger: createMemoryLogger() },
      { mode: "live", policy: DEFAULT_RETENTION_POLICY, trigger: "pg_cron" },
    );
    assert.equal(retry.deleted, 3);
    assert.ok([...w.items.values()].every((i) => i.status === "deleted" && i.attempts === 2));
  });

  it("never deletes an object whose path is not exactly that source's raw path", async () => {
    const w = world({ badPath: S1 });
    const r = await runRetentionSweep(deps(w), { mode: "live", policy: DEFAULT_RETENTION_POLICY, trigger: "manual" });
    assert.equal(w.removed.flat().includes("raw/elsewhere/x"), false);
    assert.equal(w.db.called("complete_raw_retention_item").find((c) => c.args.p_source_id === S1)?.args.p_error, "path_refused");
    assert.equal(r.failed, 1);
  });

  it("logs counts only", async () => {
    const w = world();
    const logger = createMemoryLogger();
    await runRetentionSweep({ db: w.db.client, storage: w.storage, logger }, { mode: "live", policy: DEFAULT_RETENTION_POLICY, trigger: "manual" });
    const log = JSON.stringify(logger.records);
    assert.equal(log.includes("raw/"), false);
    assert.match(log, /"deleted":3/);
  });
});

describe("retention configuration", () => {
  it("is off unless explicitly enabled; seven days by default; invalid values turn it off", () => {
    assert.deepEqual(retentionConfig({}), { mode: "off", policy: DEFAULT_RETENTION_POLICY });
    assert.deepEqual(retentionConfig({ BATON_RETENTION_MODE: "dry_run" }), { mode: "dry_run", policy: DEFAULT_RETENTION_POLICY });
    assert.equal(DEFAULT_RETENTION_POLICY.rawCeilingDays, 7);
    assert.deepEqual(retentionConfig({ BATON_RETENTION_MODE: "live", BATON_RAW_RETENTION_DAYS: "3" }), {
      mode: "live",
      policy: { ...DEFAULT_RETENTION_POLICY, rawCeilingDays: 3 },
    });
    for (const env of [
      { BATON_RETENTION_MODE: "LIVE" },
      { BATON_RETENTION_MODE: "live", BATON_RAW_RETENTION_DAYS: "0" },
      { BATON_RETENTION_MODE: "live", BATON_RAW_RETENTION_DAYS: "7d" },
      { BATON_RETENTION_MODE: "live", BATON_PENDING_UPLOAD_GRACE_HOURS: "1" },
      { BATON_RETENTION_MODE: "live", BATON_RETENTION_MAX_PER_RUN: "5000" },
    ]) {
      assert.equal(retentionConfig(env).mode, "off", JSON.stringify(env));
    }
  });
});
