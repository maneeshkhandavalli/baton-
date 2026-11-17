// Round 3 Task 01 (JOB-1): processing advances with NO browser. Tier E (opt-in: BATON_IT_PG=1, needs Docker;
// `npm test` stays Docker-free).
//
// The REAL scheduled worker endpoint (app/api/pipeline/drain → lib/pipeline/worker drainJobs → drainer,
// stages, lib/ai fake adapter) against a throw-away local Postgres with every migration (support/pg.ts).
// Only the network edges are replaced (Supabase clients → PsqlDbClient, Storage → PgBackedStorage).
//
// Every run is started through the real startProcessing action, and then the `after()` drain it scheduled is
// DISCARDED and the user is signed out: nothing a browser or the starting request would do ever runs. Only
// the scheduler's authenticated POST/GET (as pg_cron or a Vercel schedule sends it) advances the run.
//
//   1. a run completes from scheduled sweeps alone, with no session and no after() drain;
//   2. completed work is not executed again by later sweeps;
//   3. overlapping sweeps never run the same job attempt twice;
//   4. a crashed worker's lease is protected while live and recovered by a sweep once it expires;
//   5. a failure is recorded on the job and the run, ends the run, and the member reads it back;
//   6. an unauthenticated scheduler call touches nothing.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import * as drainRoute from "../../app/api/pipeline/drain/route";
import { createHandover, startProcessing } from "../../lib/actions/handovers";
import { confirmSourceUploaded, createSourceUpload, previewSource, recordSourceConsent } from "../../lib/actions/sources";
import { getQueries } from "../../lib/data";
import { SOURCE_BUCKET } from "../../lib/db/storage";
import { computeIdentityPepperCanary } from "../../lib/privacy/identity";
import { fixtureBytes, TEST_PEPPER } from "../../fixtures/parser/load";
import { captureConsole } from "./support/console-capture";
import { PgBackedStorage, PgContainer, PsqlDbClient, lit } from "./support/pg";
import {
  allowFakeAi,
  currentUserId,
  discardAfter,
  installCustomBackends,
  pendingAfter,
  resetPlatform,
  setAiEnv,
  signInAs,
  signOut,
} from "./support/platform";

const ENABLED = process.env.BATON_IT_PG === "1";
const SECRET = "r3-worker-secret-0123456789abcdefghijklmnop"; // synthetic, ≥ 32 chars
const URL = "https://baton.example.test/api/pipeline/drain";
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

const EXTRA_LINES = [
  "10/02/2024, 18:10 - Asha Rao: Ravi is responsible for the club bank account and the reimbursements every month.",
  "10/02/2024, 18:11 - Ravi Kumar: We decided to keep the sponsor list in the shared drive folder from now on.",
  "10/02/2024, 18:12 - Asha Rao: We need to renew the lab booking before the robotics fest in March.",
];

function exportBytes(): Uint8Array {
  const base = new TextDecoder().decode(fixtureBytes("whatsapp/pii-chat.txt")).replace(/\s*$/, "\n");
  return new TextEncoder().encode(`${base}${EXTRA_LINES.join("\n")}\n`);
}

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

type Report = { claimed: number; succeeded: number; retried: number; failed: number; deferred: number; skipped: number; lost: number };
type JobRow = { id: string; stage: string; status: string; attempt: number; log: number; code: string | null; message: string | null; row: string };

describe("JOB-1: the scheduled worker advances runs with no browser", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-worker", "baton_worker");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const users: Record<string, string> = {};
  const as = (name: string) => signInAs(users[name], `${name}@example.test`);

  /** What the scheduler sends: no cookies, no session, only the bearer secret. */
  async function sweep(method: "POST" | "GET" = "POST", capture = true): Promise<Report> {
    signOut();
    assert.equal(currentUserId(), null, "no browser session during a scheduled sweep");
    const headers: Record<string, string> = { authorization: `Bearer ${SECRET}` };
    if (method === "POST") headers["x-baton-trigger"] = "pg_cron";
    else headers["user-agent"] = "vercel-cron/1.0";
    const call = () => (method === "POST" ? drainRoute.POST : drainRoute.GET)(new Request(URL, { method, headers }));
    // captureConsole patches the global console, so concurrent sweeps are captured once by their caller.
    const res = capture ? (await captureConsole(call)).result : await call();
    assert.equal(res.status, 200, `sweep answered ${res.status}`);
    return (await res.json()) as Report;
  }

  const runStatus = async (runId: string) => (await pg.json<string>(`select to_jsonb(status) from public.processing_runs where id = ${lit(runId)}`))!;

  async function sweepUntilDone(runId: string, method: "POST" | "GET" = "POST"): Promise<Report[]> {
    const reports: Report[] = [];
    for (let i = 0; i < 12; i++) {
      reports.push(await sweep(i % 2 === 0 ? method : method === "POST" ? "GET" : "POST"));
      if (TERMINAL.has(await runStatus(runId))) return reports;
    }
    assert.fail(`run ${runId} did not finish: ${JSON.stringify(reports)}`);
  }

  const jobs = async (runId: string): Promise<JobRow[]> =>
    (await pg.json<JobRow[]>(`select coalesce(jsonb_agg(jsonb_build_object('id', id, 'stage', stage, 'status', status, 'attempt', attempt,
        'log', jsonb_array_length(coalesce(attempt_log, '[]'::jsonb)), 'code', error_code, 'message', error_message,
        'row', md5(to_jsonb(j)::text)) order by created_at, id), '[]'::jsonb)
       from public.processing_jobs j where run_id = ${lit(runId)}`)) ?? [];

  /** Browser part only: create, upload, confirm, consent, preview, start. Then the tab "closes". */
  async function startRunThenCloseTab(title: string): Promise<{ handoverId: string; runId: string }> {
    as("ann");
    const handoverId = ok(await createHandover({ title, teamName: "Robotics Club", roleTitle: "Treasurer", creatorRole: "outgoing" }), "create").id;
    const bytes = exportBytes();
    const ticket = ok(await createSourceUpload({ handoverId, kind: "whatsapp_export", fileName: "WhatsApp Chat with Club.txt",
      mimeType: "text/plain", sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }), "upload");
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${ticket.sourceId}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: ticket.sourceId }), "confirm");
    ok(await recordSourceConsent({ sourceId: ticket.sourceId, consentStatementVersion: "consent@1", consentConfirmed: true,
      accessLevel: "everyone", timezone: "Asia/Kolkata", dateOrder: "dmy" }), "consent");
    ok(await previewSource({ sourceId: ticket.sourceId }), "preview");
    const { runId } = ok(await startProcessing({ handoverId }), "startProcessing");
    assert.ok(pendingAfter() >= 1, "startProcessing scheduled its post-response drain");
    discardAfter(); // ... which never runs: the request ended before it (tab closed, instance frozen)
    signOut();
    assert.equal(await runStatus(runId), "queued", "nothing has run yet");
    return { handoverId, runId };
  }

  before(async () => {
    if (!ENABLED) return;
    await pg.start();
    resetPlatform();
    allowFakeAi();
    process.env.IDENTITY_PEPPER = TEST_PEPPER;
    process.env.IDENTITY_PEPPER_VERSION = "p1";
    process.env.IDENTITY_PEPPER_CANARY = computeIdentityPepperCanary(TEST_PEPPER);
    process.env.CRON_SECRET = SECRET;
    installCustomBackends({ adminDb, userDb, adminStorage: storage, userStorage: storage });
    for (const name of ["ann"]) users[name] = (await pg.json<string>(`select to_jsonb(tests.user(${lit(name)}))`))!;
  });

  after(async () => {
    delete process.env.CRON_SECRET;
    if (ENABLED) await pg.stop();
  });

  let first = { handoverId: "", runId: "" };
  let firstPoints = 0;

  it("1. a run completes from scheduled sweeps alone (no session, no after() drain)", async (t) => {
    first = await startRunThenCloseTab("Autonomous worker: happy path");
    const reports = await sweepUntilDone(first.runId);
    t.diagnostic(`sweeps: ${JSON.stringify(reports)}`);
    assert.equal(await runStatus(first.runId), "succeeded");
    assert.equal(await pg.json(`select to_jsonb(state) from public.handovers where id = ${lit(first.handoverId)}`), "in_review");
    const rows = await jobs(first.runId);
    assert.ok(rows.length >= 4, `jobs: ${JSON.stringify(rows)}`);
    assert.ok(rows.every((j) => j.status === "succeeded" && j.attempt === 1 && j.log <= 1 && j.code === null), JSON.stringify(rows));
    firstPoints = (await pg.json<number>(`select to_jsonb(count(*)) from public.handover_points where handover_id = ${lit(first.handoverId)}`))!;
    assert.ok(firstPoints > 0, "the run produced points");
  });

  it("2. completed work is not executed again by later sweeps", async () => {
    const before = await jobs(first.runId);
    const runBefore = await pg.json(`select to_jsonb(md5(to_jsonb(r)::text)) from public.processing_runs r where id = ${lit(first.runId)}`);
    for (const method of ["POST", "GET"] as const) {
      const report = await sweep(method);
      assert.equal(report.claimed, 0, `${method}: nothing left to claim`);
    }
    assert.deepEqual(await jobs(first.runId), before, "no job row changed");
    assert.deepEqual(await pg.json(`select to_jsonb(md5(to_jsonb(r)::text)) from public.processing_runs r where id = ${lit(first.runId)}`), runBefore);
    assert.equal(await pg.json(`select to_jsonb(count(*)) from public.handover_points where handover_id = ${lit(first.handoverId)}`), firstPoints);
  });

  it("3. overlapping sweeps never run the same job attempt twice", async (t) => {
    // Two runs, so several jobs are ready at once and the concurrent sweeps genuinely contend for claims.
    const a = await startRunThenCloseTab("Autonomous worker: overlap A");
    const b = await startRunThenCloseTab("Autonomous worker: overlap B");
    const reports: Report[] = [];
    const done = async () => TERMINAL.has(await runStatus(a.runId)) && TERMINAL.has(await runStatus(b.runId));
    for (let round = 0; round < 10 && !(await done()); round++) {
      const { result } = await captureConsole(() => Promise.all([sweep("POST", false), sweep("GET", false), sweep("POST", false)]));
      reports.push(...result);
    }
    t.diagnostic(`overlapping sweeps: ${JSON.stringify(reports)}`);
    t.diagnostic(`sweeps that claimed work: ${reports.filter((r) => r.claimed > 0).length} of ${reports.length}`);
    const rows: JobRow[] = [];
    for (const { handoverId, runId } of [a, b]) {
      assert.equal(await runStatus(runId), "succeeded");
      const own = await jobs(runId);
      rows.push(...own);
      assert.ok(own.every((j) => j.status === "succeeded" && j.attempt === 1 && j.log <= 1), `each job ran exactly once: ${JSON.stringify(own)}`);
      assert.equal(await pg.json(`select to_jsonb(count(*)) from public.handover_points where handover_id = ${lit(handoverId)}`), firstPoints,
        "no duplicate points from concurrent sweeps");
    }
    const total = reports.reduce((n, r) => n + r.succeeded, 0);
    assert.equal(total, rows.length, "every job was completed by exactly one sweep");
    assert.equal(reports.reduce((n, r) => n + r.lost + r.retried + r.failed, 0), 0, "no lost claim, retry or failure");
  });

  it("4. a crashed worker's lease is protected while live, then recovered by a sweep", async () => {
    const { runId } = await startRunThenCloseTab("Autonomous worker: crash recovery");
    // A worker claims the first job and dies without heartbeating or completing it.
    const claimed = (await adminDb.rpc("claim_ready_processing_jobs", { p_limit: 1, p_lease_seconds: 30 })).data as Array<{ id: string; attempt: number }>;
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].attempt, 1);

    const whileLive = await sweep();
    assert.equal(whileLive.claimed, 0, "a live lease is never taken over");
    assert.equal((await jobs(runId)).find((j) => j.id === claimed[0].id)?.status, "running");

    // Time passes: the lease expires (30 s is the minimum lease; expiring it directly keeps the test fast).
    await pg.json(`update public.processing_jobs set lease_expires_at = now() - interval '1 second' where id = ${lit(claimed[0].id)}`);
    await sweepUntilDone(runId);
    assert.equal(await runStatus(runId), "succeeded");
    const crashed = (await jobs(runId)).find((j) => j.id === claimed[0].id)!;
    assert.equal(crashed.status, "succeeded");
    assert.equal(crashed.attempt, 2, "recovered as a new attempt");
    assert.ok((await jobs(runId)).filter((j) => j.id !== claimed[0].id).every((j) => j.attempt === 1), "no other job lost an attempt");
  });

  it("5. a failure is recorded on the job and the run, ends the run, and the member reads it", async () => {
    const { handoverId, runId } = await startRunThenCloseTab("Autonomous worker: failure");
    // The server's AI provider is refused while the run is in flight (e.g. a configuration change): the AI
    // stage fails closed and is not retried.
    setAiEnv({ AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "production" });
    try {
      await sweepUntilDone(runId);
    } finally {
      allowFakeAi();
    }
    assert.equal(await runStatus(runId), "failed");
    const rows = await jobs(runId);
    const failedJob = rows.find((j) => j.status === "failed");
    assert.ok(failedJob, JSON.stringify(rows));
    assert.equal(failedJob.message, "provider_not_configured");
    assert.equal(failedJob.attempt, 1, "a configuration failure is not retried");
    assert.ok(rows.every((j) => j.status !== "running" && j.status !== "queued"), "nothing is left running or queued");

    as("ann");
    const status = ok(await getQueries().getProcessingStatus(handoverId), "getProcessingStatus");
    assert.equal(status.run?.status, "failed", "the member sees the failure when they come back");
    signOut();

    const later = await sweep();
    assert.equal(later.claimed, 0, "a failed run is not picked up again");
  });

  it("6. an unauthenticated scheduler call touches nothing", async () => {
    const { runId } = await startRunThenCloseTab("Autonomous worker: unauthenticated");
    const calls = adminDb.calls.length;
    for (const headers of [{}, { authorization: `Bearer ${SECRET.slice(0, -1)}x` }, { "user-agent": "vercel-cron/1.0" }] as Array<Record<string, string>>) {
      const { result: res } = await captureConsole(() => drainRoute.POST(new Request(URL, { method: "POST", headers })));
      assert.equal(res.status, 401);
    }
    assert.equal(adminDb.calls.length, calls, "no database call");
    assert.equal(await runStatus(runId), "queued");
    await sweepUntilDone(runId);
    assert.equal(await runStatus(runId), "succeeded");
  });
});
