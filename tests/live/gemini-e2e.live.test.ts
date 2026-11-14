// ONE synthetic end-to-end LIVE test: real Gemini (free tier) + the real worker against baton-dev, which also
// verifies the Phase D claim-generation path. NOT part of `npm test`. It writes to baton-dev, so it only
// runs with BOTH opt-ins:
//
//   BATON_LIVE_E2E=1 BATON_LIVE_E2E_CONFIRM=run-gemini-e2e-on-xnwppnzvrpthukxjfojj \
//   BATON_LIVE_ACTOR_PROFILE_ID=<your baton-dev profile uuid> \
//   node --import ./tests/live/resolve-live.mjs --test tests/live/gemini-e2e.live.test.ts
//
// Configuration comes ONLY from <repo>/.env.baton-dev (read literally, like restore-dev/start-baton-dev.mjs),
// which must contain AI_API_KEY. This process forces AI_PROVIDER=gemini for itself; the file is not changed.
//
// What it does (synthetic data only: fixtures/demo/round2-gemini-e2e.txt, 23 invented lines covering every
// point category, an unanswered question, an owner-less undated task and two planted PII values):
//   1. guards: target is baton-dev and never the original project; the local dev server is NOT running
//      (its worker would claim this run with a different AI config); no queued/running job or open run
//      anywhere in baton-dev (the claim is global); the actor profile exists.
//   2. setup through the same lib/db mutations the Server Functions call (create handover, source,
//      signed upload, confirm, consent naming provider "gemini" + statement gemini-free-2026-11-14-v1,
//      plan, start_processing). Only the session layer is skipped: the actor is given explicitly.
//   3. the REAL worker: lib/pipeline/worker.ts drainJobs (claim → fenced writes → Gemini), until the run ends.
//   4. assertions: run/jobs succeeded; every pipeline_* RPC the worker sent carried p_claim_generation equal
//      to the claimed row's generation (recorded from the wire, Supabase RPC paths only, no bodies kept);
//      Gemini provenance and token counts; masking; evidence; nothing published; the API key appears in no
//      row read back; a stale claim (finished job) is refused with BTLL0 by both overloads. Evidence quality
//      (tests/live/evidence-check.ts, pure): every exact/normalized quote is a substring of its cited message
//      body; owner/assignee labels and due dates in attributes appear in the source text; the owner-less
//      task is given no owner or date.
//   5. cleanup (always): soft-delete through delete_handover. Prints the handover id and the optional
//      hard-purge SQL (purge_handover is granted to no app role, so it runs in the baton-dev SQL editor).
// Output is ids, counts and statuses, plus (because the fixture is entirely synthetic) up to 12 findings as
// `category | title | first verified quote` and any check violations. Never secrets.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { inventedOwnerOrDate, quotesAreVerbatim, stripChatTimestamps, unsupportedAttributes } from "./evidence-check";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET = "xnwppnzvrpthukxjfojj";
const CONFIRM = `run-gemini-e2e-on-${TARGET}`;
const FORBIDDEN = ["enalguyitewjojgrgzxv", "enalguyitewjojgrgzv"];
const STATEMENT = "gemini-free-2026-11-14-v1";
const FIXTURE = path.join(REPO, "fixtures/demo/round2-gemini-e2e.txt");
const PLANTED = ["99999 00002", "treasurer@example.org"]; // synthetic PII in the fixture; must be masked
/** The fixture's one task that names no owner and no date (the model must not invent them). */
const OWNERLESS_TASK = "registration form still needs to be updated";
const MAX_FINDINGS_PRINTED = 12;
const RUN_TIMEOUT_MS = 12 * 60_000;

const ENABLED = process.env.BATON_LIVE_E2E === "1" && process.env.BATON_LIVE_E2E_CONFIRM === CONFIRM;
const skip = ENABLED ? false : `opt-in only (BATON_LIVE_E2E=1 and BATON_LIVE_E2E_CONFIRM=${CONFIRM}); writes to baton-dev and makes real Gemini calls`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadBatonDevEnv(): void {
  const file = path.join(REPO, ".env.baton-dev");
  if (!existsSync(file)) throw new Error("REFUSED: .env.baton-dev is missing");
  const vars = Object.fromEntries(
    readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  if (FORBIDDEN.some((r) => JSON.stringify(vars).toLowerCase().includes(r))) throw new Error("REFUSED: .env.baton-dev mentions the ORIGINAL project");
  if (new URL(vars.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname !== `${TARGET}.supabase.co`) throw new Error("REFUSED: .env.baton-dev does not point at baton-dev");
  // Every Supabase variable comes from the file, never from an inherited shell or .env.local.
  for (const k of Object.keys(process.env)) if (k.includes("SUPABASE") && !(k in vars)) delete process.env[k];
  Object.assign(process.env, vars);
  process.env.AI_PROVIDER = "gemini";
  delete process.env.AI_MODEL_EXTRACT; // the agreed default, gemini-3.8-flash, for both stages
  delete process.env.AI_MODEL_VERIFY;
  if (!process.env.AI_API_KEY?.trim()) throw new Error("REFUSED: AI_API_KEY is not set in .env.baton-dev");
}

/** Records, from the wire, which fenced writer was called and the claim fields it carried. Nothing else. */
type RpcCall = { fn: string; jobId: string | null; attempt: number | null; generation: number | null };
function recordPipelineRpcs(origin: string): RpcCall[] {
  const calls: RpcCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const m = url.startsWith(`${origin}/rest/v1/rpc/`) ? /\/rpc\/(pipeline_[a-z_]+)/.exec(url) : null;
      if (m && typeof init?.body === "string") {
        const b = JSON.parse(init.body) as Record<string, unknown>;
        calls.push({
          fn: m[1],
          jobId: typeof b.p_job_id === "string" ? b.p_job_id : null,
          attempt: typeof b.p_attempt === "number" ? b.p_attempt : null,
          generation: typeof b.p_claim_generation === "number" ? b.p_claim_generation : null,
        });
      }
    } catch {
      // recording must never affect the request
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  return calls;
}

describe("LIVE: Gemini end-to-end on baton-dev through the real worker (claim generation)", { skip }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let m: any = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let actor: any;
  let handoverId: string | null = null;
  let runId: string | null = null;
  let rpcCalls: RpcCall[] = [];

  before(async () => {
    loadBatonDevEnv();
    const profileId = process.env.BATON_LIVE_ACTOR_PROFILE_ID ?? "";
    assert.match(profileId, UUID, "BATON_LIVE_ACTOR_PROFILE_ID must be your baton-dev profile uuid");

    // The local dev server's worker would claim this run under the fake config: it must be stopped.
    const devServerUp = await fetch("http://localhost:3000/", { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    assert.equal(devServerUp, false, "REFUSED: something is serving localhost:3000; stop the dev server first");

    rpcCalls = recordPipelineRpcs(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin);
    m = {
      ...(await import("../../lib/supabase/admin")),
      ...(await import("../../lib/db")),
      mutations: await import("../../lib/db/mutations"),
      storage: await import("../../lib/db/storage"),
      worker: await import("../../lib/pipeline/worker"),
      plan: await import("../../lib/pipeline/plan"),
      config: await import("../../lib/ai/config"),
    };
    const cfg = m.config.getAiConfiguration();
    assert.ok(cfg.ok && cfg.mode === "production" && cfg.provider.id === "gemini", "Gemini must be configured");
    assert.equal(cfg.runConfig.extract.model, "gemini-3.8-flash");
    assert.equal(cfg.runConfig.verify.model, "gemini-3.8-flash");

    admin = m.createSupabaseAdminClient();
    const prof = await admin.from("profiles").select("id, deleted_at").eq("id", profileId).maybeSingle();
    assert.ok(prof.data && !prof.data.deleted_at, "actor profile not found in baton-dev");
    // Test-only construction of the actor (the session layer is what this test skips).
    actor = { profileId, email: null, emailConfirmed: true };

    const open = await admin.from("processing_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
    const openRuns = await admin.from("processing_runs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
    assert.equal(open.count, 0, "REFUSED: baton-dev has queued/running jobs (the claim is global)");
    assert.equal(openRuns.count, 0, "REFUSED: baton-dev has an open run");
  });

  after(async () => {
    if (!handoverId || !m.mutations) return;
    if (process.env.BATON_LIVE_E2E_KEEP === "1") {
      console.log(`[live-e2e] KEPT handover ${handoverId} (BATON_LIVE_E2E_KEEP=1)`);
      return;
    }
    try {
      await m.mutations.deleteHandover(m.serverDb(), actor, handoverId);
      console.log(`[live-e2e] soft-deleted handover ${handoverId}`);
    } catch (e) {
      console.log(`[live-e2e] CLEANUP FAILED for handover ${handoverId}: ${(e as Error)?.name}`);
    }
    try {
      const list = await m.serverStorage().from(m.storage.SOURCE_BUCKET).list(`raw/${handoverId}`, { limit: 100 });
      const paths = (list.data ?? []).map((o: { name: string }) => `raw/${handoverId}/${o.name}`);
      if (paths.length) await m.serverStorage().from(m.storage.SOURCE_BUCKET).remove(paths);
      console.log(`[live-e2e] raw objects left after cleanup: 0 (removed ${paths.length})`);
    } catch {
      console.log("[live-e2e] raw object check failed; verify storage raw/<handover>/ manually");
    }
    console.log(`[live-e2e] optional hard purge (baton-dev SQL editor, as postgres):\n  select public.purge_handover(gen_random_uuid(), '${handoverId}', '${actor.profileId}');`);
  });

  it("processes the synthetic demo chat with Gemini through the real worker", async () => {
    const db = m.serverDb();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    handoverId = await m.mutations.createHandover(db, actor, {
      title: `ZZ TEST Gemini e2e ${stamp}`,
      teamName: "Synthetic Debate Society",
      roleTitle: "Secretary",
      creatorRole: "outgoing",
    });
    console.log(`[live-e2e] handover ${handoverId}`);

    const bytes = readFileSync(FIXTURE);
    const ticket = await m.storage.createSourceUpload(db, actor, m.serverStorage(), {
      handoverId,
      kind: "whatsapp",
      fileName: "WhatsApp Chat with Synthetic Debate Society Committee.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const sourceId: string = ticket.sourceId;
    const up = await m.serverStorage().from(m.storage.SOURCE_BUCKET)
      .uploadToSignedUrl(m.storage.rawSourcePath(handoverId, sourceId), ticket.token, bytes, { contentType: "text/plain" });
    assert.ok(!up.error, "signed upload failed");
    await m.storage.confirmSourceUpload(db, m.serverStorage(), actor, sourceId);
    await m.mutations.recordSourceConsent(db, actor, {
      sourceId,
      consentStatementVersion: STATEMENT,
      aiProvider: "gemini",
      accessLevel: "everyone",
      timezone: "Asia/Kolkata",
      dateOrder: "dmy",
    });

    const runConfig = m.config.getAiConfiguration().runConfig;
    const plan = m.plan.planProcessingRun({ handoverId, sources: [{ id: sourceId, state: "uploaded", rawAvailable: true }], aiConfig: runConfig });
    assert.ok(plan.ok);
    assert.equal(plan.data.jobs.length, 6);
    ({ runId } = await m.mutations.startProcessing(db, actor, {
      handoverId,
      pipelineVersion: plan.data.pipelineVersion,
      aiConfig: { ...plan.data.aiConfig },
      jobs: plan.data.jobs,
    }));
    console.log(`[live-e2e] run ${runId}`);

    // The real worker, exactly as the cron route / dev loop call it.
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let status = "queued";
    while (Date.now() < deadline) {
      const report = await m.worker.drainJobs({ maxJobs: 10, deadlineMs: 240_000 });
      console.log(`[live-e2e] drain claimed=${report.claimed} succeeded=${report.succeeded} retried=${report.retried} failed=${report.failed} deferred=${report.deferred} lost=${report.lost}`);
      status = (await admin.from("processing_runs").select("status").eq("id", runId).single()).data.status;
      if (!["queued", "running"].includes(status)) break;
      if (report.claimed === 0) await new Promise((r) => setTimeout(r, 5_000)); // backoff window of a retry
    }

    const run = (await admin.from("processing_runs").select("status, ai_provider, ai_config, error_code, error_message").eq("id", runId).single()).data;
    const jobs = (await admin.from("processing_jobs")
      .select("id, stage, status, attempt, claim_generation, error_code, error_message, ai_provenance, attempt_log, lease_expires_at")
      .eq("run_id", runId)).data as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const j of jobs) console.log(`[live-e2e] job ${j.stage}: ${j.status} attempt=${j.attempt} generation=${j.claim_generation} error=${j.error_message ?? "-"}`);
    assert.equal(run.status, "succeeded", `run ended ${run.status} (${run.error_message})`);
    assert.equal(run.ai_provider, "gemini");
    assert.equal(run.ai_config.extract.model, "gemini-3.8-flash");
    assert.equal(run.ai_config.verify.model, "gemini-3.8-flash");

    // ── Phase D claim generation ──
    assert.equal(jobs.length, 6);
    for (const j of jobs) {
      assert.equal(j.status, "succeeded", `${j.stage} ${j.status}`);
      assert.equal(j.lease_expires_at, null);
      const g = Number(j.claim_generation);
      assert.ok(Number.isSafeInteger(g) && g >= 1 && g >= j.attempt, `${j.stage}: claim_generation ${j.claim_generation} vs attempt ${j.attempt}`);
    }
    const byJob = new Map(jobs.map((j) => [j.id, j]));
    const mine = rpcCalls.filter((c) => c.jobId && byJob.has(c.jobId));
    console.log(`[live-e2e] fenced pipeline_* calls: ${mine.length} (${[...new Set(mine.map((c) => c.fn))].sort().join(", ")})`);
    assert.ok(mine.length >= 6, "the worker made fenced writes");
    for (const c of mine) {
      assert.notEqual(c.generation, null, `${c.fn} was sent WITHOUT p_claim_generation (attempt-only fence)`);
      assert.ok((c.generation as number) <= Number(byJob.get(c.jobId!)!.claim_generation), `${c.fn}: generation newer than the job's`);
    }
    for (const fn of ["pipeline_persist_parsed_source", "pipeline_set_job_provenance", "pipeline_store_extract_chunk", "pipeline_record_quote_check", "pipeline_set_point_sort_keys"]) {
      assert.ok(mine.some((c) => c.fn === fn), `expected a ${fn} call`);
    }

    // ── Stale claim is refused (no write): finished extract job, with and without its generation ──
    const extract = jobs.find((j) => j.stage === "extract")!;
    for (const args of [
      { p_job_id: extract.id, p_attempt: extract.attempt, p_claim_generation: Number(extract.claim_generation), p_provenance: { stale: true } },
      { p_job_id: extract.id, p_attempt: extract.attempt, p_provenance: { stale: true } },
    ]) {
      const r = await admin.rpc("pipeline_set_job_provenance", args);
      assert.equal(r.error?.code, "BTLL0", `stale claim not refused (${r.error?.code ?? "accepted"})`);
    }
    const probed = (await admin.from("processing_jobs").select("ai_provenance").eq("id", extract.id).single()).data;
    assert.deepEqual(probed.ai_provenance, extract.ai_provenance, "a refused stale claim changed the job");

    // ── Gemini provenance and usage ──
    for (const stage of ["extract", "verify_support"]) {
      const j = jobs.find((x) => x.stage === stage)!;
      if (j.ai_provenance === null) continue; // verify_support with nothing to verify resolves no provider
      assert.equal(j.ai_provenance.provider, "gemini");
      assert.equal(j.ai_provenance.adapterVersion, "gemini@1");
      assert.equal(j.ai_provenance.requestedModel, "gemini-3.8-flash");
    }
    const exLog = (extract.attempt_log as Array<Record<string, unknown>>).at(-1)!;
    console.log(`[live-e2e] extract tokens in=${exLog.inputTokens} out=${exLog.outputTokens} latencyMs=${exLog.latencyMs} model=${exLog.reportedModel}`);
    assert.equal(exLog.outcome, "succeeded");
    assert.ok(Number(exLog.inputTokens) > 0);

    // ── Masking, evidence, review state ──
    const source = (await admin.from("sources").select("state, raw_storage_path, masking_counts, consent_ai_provider, consent_statement_version").eq("id", sourceId).single()).data;
    assert.equal(source.state, "parsed");
    assert.equal(source.raw_storage_path, null, "raw upload deleted after the parse");
    assert.equal(source.consent_ai_provider, "gemini");
    assert.equal(source.consent_statement_version, STATEMENT);
    const msgs = (await admin.from("source_messages").select("id, body").eq("source_id", sourceId)).data as Array<{ id: string; body: string }>;
    assert.ok(msgs.length > 0);
    for (const p of PLANTED) assert.ok(!msgs.some((x) => x.body.includes(p)), "planted PII persisted unmasked");

    const points = (await admin.from("handover_points").select("id, category, review_state, origin, current_revision_id").eq("handover_id", handoverId)).data as Array<Record<string, string>>;
    const revs = (await admin.from("point_revisions").select("id, point_id, title, statement, attributes, ai_provenance").eq("handover_id", handoverId)).data as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const quotes = (await admin.from("evidence_quotes").select("id, source_message_id, quote_text, quote_check").eq("handover_id", handoverId)).data as Array<{ id: string; source_message_id: string | null; quote_text: string; quote_check: string }>;
    const links = (await admin.from("point_evidence").select("point_id, evidence_id, support_verdict, verifier_provenance").eq("handover_id", handoverId)).data as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const tally = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
    console.log(`[live-e2e] points=${points.length} ${JSON.stringify(tally(points.map((p) => p.category)))} quotes=${JSON.stringify(tally(quotes.map((q) => q.quote_check)))} verdicts=${JSON.stringify(tally(links.map((l) => l.support_verdict)))}`);
    assert.ok(points.length >= 3, "Gemini extracted points from the demo chat");
    assert.ok(points.every((p) => p.review_state === "pending" && p.origin === "extracted"));
    assert.ok(revs.every((r) => r.ai_provenance?.provider === "gemini"));
    for (const r of revs) for (const p of PLANTED) assert.ok(!JSON.stringify([r.title, r.statement, r.attributes]).includes(p), "unmasked value in a stored point");
    assert.ok(quotes.some((q) => q.quote_check === "exact" || q.quote_check === "normalized"), "at least one verified verbatim quote");
    assert.ok(links.some((l) => l.support_verdict !== "unchecked" && l.verifier_provenance?.provider === "gemini"), "Gemini verified support");

    // ── Evidence quality (pure checks, tests/live/evidence-check.ts) ──
    const revById = new Map(revs.map((r) => [r.id as string, r]));
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
    type QuoteRow = (typeof quotes)[number];
    const isVerified = (q: QuoteRow | undefined): q is QuoteRow => q !== undefined && (q.quote_check === "exact" || q.quote_check === "normalized");
    const current = points.map((p) => {
      const rev = revById.get(p.current_revision_id);
      const cited = links.filter((l) => l.point_id === p.id).map((l) => quoteById.get(l.evidence_id)).filter(isVerified);
      return { category: p.category, title: String(rev?.title ?? "?"), attributes: (rev?.attributes ?? {}) as Record<string, unknown>, cited };
    });

    const bodies = new Map(msgs.map((x) => [x.id, x.body]));
    const quoteViolations = quotesAreVerbatim(quotes, bodies);
    const sourceText = stripChatTimestamps(bytes.toString("utf8"));
    const attributeViolations = unsupportedAttributes(current, sourceText, { dateOrder: "dmy" });
    const ownerless = new Set(msgs.filter((x) => x.body.includes(OWNERLESS_TASK)).map((x) => x.id));
    assert.equal(ownerless.size, 1, "the owner-less task message was persisted once");
    const invented = inventedOwnerOrDate(
      current.map((c) => ({ ...c, messageIds: c.cited.map((q) => q.source_message_id).filter((id): id is string => id !== null) })),
      ownerless,
    );
    const ownerlessExtracted = current.some((c) => c.cited.some((q) => q.source_message_id !== null && ownerless.has(q.source_message_id)));
    console.log(
      `[live-e2e] evidence checks: quotes=${quotes.length} verified=${quotes.filter(isVerified).length} quoteViolations=${quoteViolations.length} ` +
        `attributeViolations=${attributeViolations.length} ownerlessTaskExtracted=${ownerlessExtracted} inventedOwnerOrDate=${invented.length}`,
    );
    for (const v of quoteViolations) console.log(`[live-e2e]   quote violation: ${v.reason} quote=${v.quoteId} message=${v.sourceMessageId} check=${v.quoteCheck}`);
    for (const v of attributeViolations) console.log(`[live-e2e]   attribute violation: ${v.reason} ${v.category}.${v.field}=${JSON.stringify(v.value)} (${current[v.index].title})`);
    for (const v of invented) console.log(`[live-e2e]   invented for the owner-less task: ${v.category}.${v.field}=${JSON.stringify(v.value)}`);

    // Synthetic data only, so a sample of findings is printed for the lead to show.
    const sample = [...current].sort((a, b) => a.category.localeCompare(b.category)).slice(0, MAX_FINDINGS_PRINTED);
    console.log(`[live-e2e] findings (${sample.length} of ${current.length}): category | title | first verified quote`);
    for (const c of sample) console.log(`[live-e2e]   ${c.category} | ${c.title} | ${c.cited[0] ? JSON.stringify(c.cited[0].quote_text) : "(no verified quote)"}`);

    assert.deepEqual(quoteViolations, [], "a quote marked exact/normalized is not a substring of its cited message");
    assert.deepEqual(attributeViolations, [], "an owner/assignee label or due date is not in the source text");
    assert.deepEqual(invented, [], "the owner-less, undated task was given an owner or a date");

    const h = (await admin.from("handovers").select("state").eq("id", handoverId).single()).data;
    assert.equal(h.state, "in_review");
    const pubs = await admin.from("handover_publications").select("id", { count: "exact", head: true }).eq("handover_id", handoverId);
    const tokens = await admin.from("access_tokens").select("id", { count: "exact", head: true }).eq("handover_id", handoverId);
    assert.equal(pubs.count, 0);
    assert.equal(tokens.count, 0);

    // ── The API key is in no row read back ──
    const key = process.env.AI_API_KEY!.trim();
    assert.ok(!JSON.stringify({ run, jobs, revs, links, quotes, msgs, source }).includes(key), "API key found in database rows");
  });
});
