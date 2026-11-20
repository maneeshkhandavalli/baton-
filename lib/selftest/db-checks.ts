/**
 * Database, auth, storage and worker checks for /test. READ-ONLY: head/count selects, one stable RPC
 * (pipeline_work_due), auth listUsers (page size 1) and getBucket. Failures show a fixed message plus the
 * PostgREST/Auth error code only, never an error message or URL.
 */

import { fail, ok, warn, type CheckRow } from "./types";

/** The subset of the supabase-js client these checks use (keeps tests simple). */
export interface SelfTestDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
  auth: { admin: { listUsers(params: { page: number; perPage: number }): Promise<{ data: unknown; error: unknown }> } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage: { getBucket(id: string): Promise<{ data: any; error: unknown }> };
}

/** Tables that exist in supabase/migrations and matter for a live run. */
export const KEY_TABLES = [
  "handovers",
  "sources",
  "processing_runs",
  "processing_jobs",
  "pipeline_worker_slots",
  "handover_people",
  "connector_installations",
  "connector_capture_windows",
  "invitation_deliveries",
  "profiles",
] as const;

function errCode(error: unknown): string {
  const e = error as { code?: unknown; status?: unknown } | null;
  const code = typeof e?.code === "string" && /^[A-Za-z0-9_]{1,20}$/.test(e.code) ? e.code : typeof e?.status === "number" ? `HTTP ${e.status}` : "unknown";
  return code;
}

export async function tableCheck(db: SelfTestDb, table: string): Promise<CheckRow> {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) return fail(`Table ${table}`, `not reachable (code ${errCode(error)})`);
  return ok(`Table ${table}`, `reachable, ${typeof count === "number" ? count.toLocaleString("en-US") : "?"} rows`);
}

export async function jobCountChecks(db: SelfTestDb, now: Date): Promise<CheckRow[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [active, failed, activeRuns] = await Promise.all([
    db.from("processing_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
    db.from("processing_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("finished_at", since),
    db.from("processing_runs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
  ]);
  const rows: CheckRow[] = [];
  rows.push(active.error ? fail("Queued or running jobs", `query failed (code ${errCode(active.error)})`) : ok("Queued or running jobs", String(active.count ?? 0)));
  rows.push(activeRuns.error ? fail("Active processing runs", `query failed (code ${errCode(activeRuns.error)})`) : ok("Active processing runs", String(activeRuns.count ?? 0)));
  if (failed.error) rows.push(fail("Failed jobs, last 24h", `query failed (code ${errCode(failed.error)})`));
  else rows.push((failed.count ?? 0) > 0 ? warn("Failed jobs, last 24h", String(failed.count)) : ok("Failed jobs, last 24h", "0"));
  return rows;
}

export async function authCheck(db: SelfTestDb): Promise<CheckRow> {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) return fail("Supabase Auth", `admin API refused (code ${errCode(error)})`);
  const total = (data as { total?: unknown } | null)?.total;
  return ok("Supabase Auth", `reachable${typeof total === "number" && total > 0 ? `, ${total.toLocaleString("en-US")} users` : ""}`);
}

export async function bucketCheck(db: SelfTestDb, bucket: string): Promise<CheckRow> {
  const { data, error } = await db.storage.getBucket(bucket);
  if (error || !data) return fail(`Storage bucket ${bucket}`, `not found or not reachable (code ${errCode(error)})`);
  return data.public === true ? warn(`Storage bucket ${bucket}`, "exists, but is PUBLIC (should be private)") : ok(`Storage bucket ${bucket}`, "exists, private");
}

export async function workDueCheck(db: SelfTestDb): Promise<CheckRow> {
  const { data, error } = await db.rpc("pipeline_work_due");
  if (error) return fail("Pipeline work due", `rpc failed (code ${errCode(error)})`);
  return ok("Pipeline work due", data === true ? "yes, a sweep has work to do now" : "no, nothing is waiting");
}

export async function lastRunCheck(db: SelfTestDb): Promise<CheckRow> {
  const { data, error } = await db
    .from("processing_runs")
    .select("finished_at, ai_provider")
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) return fail("Last succeeded run", `query failed (code ${errCode(error)})`);
  const row = Array.isArray(data) ? (data[0] as { finished_at?: string | null; ai_provider?: string } | undefined) : undefined;
  if (!row) return warn("Last succeeded run", "none yet");
  const provider = typeof row.ai_provider === "string" ? row.ai_provider.slice(0, 40) : "?";
  return ok("Last succeeded run", `${row.finished_at ?? "unknown time"}, provider ${provider}`);
}
