// Round 3 Tier E (opt-in: BATON_IT_PG=1, needs Docker; `npm test` stays Docker-free): B4 + B2 on real Postgres.
//
// One handover, THREE sources processed in one run with the real Server Functions, lib/db, lib/parsers,
// lib/pipeline drainer and lib/ai fake adapter (wired like lib/pipeline/worker.ts):
//   * tests/fixtures/round3-conflict/chat.txt      (WhatsApp, DD/MM)  ─┐ disagree about the bank signing
//   * tests/fixtures/round3-conflict/handbook.md   (Markdown)         ─┘ mandate (31 March vs 31 January)
//   * a "WhatsApp export" that is not a chat at all → its parse fails.
// Expected (B4): the broken source fails alone (state failed, raw kept for a retry, reason token only), the
// other two are parsed, extracted and verified, the run succeeds and the handover is in review.
// Expected (B2): one owner point is `conflicting` with one `supports` and one `contradicts` link (one per
// source); it cannot be approved without a resolution note, and resolving it approves it.
//
//   BATON_IT_PG=1 BATON_IT_CONTAINER=baton-it-agent05 node --import ./tests/integration/support/resolve.mjs \
//     --test tests/integration/r3-e2e-multisource.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getAiProviderForRun } from "../../lib/ai/config";
import { extractCandidates } from "../../lib/ai/extract";
import { verifySupport } from "../../lib/ai/verify-support";
import { createHandover, startProcessing } from "../../lib/actions/handovers";
import { reviewPoint } from "../../lib/actions/review";
import { confirmSourceUploaded, createSourceUpload, recordSourceConsent } from "../../lib/actions/sources";
import { getQueries } from "../../lib/data";
import { SOURCE_BUCKET } from "../../lib/db/storage";
import { createConsoleLogger } from "../../lib/pipeline/log";
import { getVerifiedPepper } from "../../lib/pipeline/pepper";
import { createDrainer } from "../../lib/pipeline/runner";
import { computeIdentityPepperCanary } from "../../lib/privacy/identity";
import { TEST_PEPPER } from "../../fixtures/parser/load";
import { captureConsole } from "./support/console-capture";
import { PgBackedStorage, PgContainer, PsqlDbClient, lit } from "./support/pg";
import { allowFakeAi, currentUserId, flushAfter, installCustomBackends, resetPlatform, signInAs } from "./support/platform";
import { assertNoLeaks } from "./support/sentinels";

const ENABLED = process.env.BATON_IT_PG === "1";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "round3-conflict");
const BROKEN = new TextEncoder().encode("This file is not a WhatsApp export.\nIt has no dated lines at all.\n");

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

type Upload = { name: string; kind: "whatsapp_export" | "markdown"; mime: string; bytes: Uint8Array };

describe("Tier E (R3): multi-source run with one failing source, and a real conflict", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-e2e-r3");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let handoverId = "";
  let runId = "";

  before(async () => {
    if (!ENABLED) return;
    await pg.start();
    resetPlatform();
    allowFakeAi();
    process.env.IDENTITY_PEPPER = TEST_PEPPER;
    process.env.IDENTITY_PEPPER_VERSION = "p1";
    process.env.IDENTITY_PEPPER_CANARY = computeIdentityPepperCanary(TEST_PEPPER);
    installCustomBackends({ adminDb, userDb, adminStorage: storage, userStorage: storage });
    users.ann = (await pg.json<string>(`select to_jsonb(tests.user('ann'))`))!;
  });

  after(async () => {
    if (ENABLED) await pg.stop();
  });

  it("1. uploads three sources (one broken), confirms and records consent for each", async () => {
    signInAs(users.ann, "ann@example.test");
    handoverId = ok(await createHandover({ title: "QA conflict handover", teamName: "Synthetic Robotics Club", roleTitle: "Treasurer",
      creatorRole: "outgoing" }), "createHandover").id;
    const uploads: Upload[] = [
      { name: "chat.txt", kind: "whatsapp_export", mime: "text/plain", bytes: new Uint8Array(readFileSync(join(DIR, "chat.txt"))) },
      { name: "handbook.md", kind: "markdown", mime: "text/markdown", bytes: new Uint8Array(readFileSync(join(DIR, "handbook.md"))) },
      { name: "broken-export.txt", kind: "whatsapp_export", mime: "text/plain", bytes: BROKEN },
    ];
    for (const u of uploads) {
      const ticket = ok(await createSourceUpload({ handoverId, kind: u.kind, fileName: u.name, mimeType: u.mime, sizeBytes: u.bytes.byteLength,
        sha256: createHash("sha256").update(u.bytes).digest("hex") }), `upload ${u.name}`);
      ids[u.name] = ticket.sourceId;
      await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${ticket.sourceId}`, u.bytes);
      ok(await confirmSourceUploaded({ sourceId: ticket.sourceId }), `confirm ${u.name}`);
      ok(await recordSourceConsent({ sourceId: ticket.sourceId, consentStatementVersion: "consent@1", consentConfirmed: true,
        accessLevel: "everyone", timezone: "Asia/Kolkata", ...(u.kind === "whatsapp_export" ? { dateOrder: "dmy" as const } : {}) }), `consent ${u.name}`);
    }
  });

  it("2. processes all three in one run; retry backoffs are fast-forwarded, never skipped", async (t) => {
    signInAs(users.ann, "ann@example.test");
    runId = ok(await startProcessing({ handoverId }), "startProcessing").runId;
    const drain = createDrainer({
      db: adminDb, storage, logger: createConsoleLogger(), getPepper: getVerifiedPepper,
      ai: { providerForRun: (rc) => getAiProviderForRun(rc), extractCandidates, verifySupport },
    });
    let status = "queued";
    for (let i = 0; i < 60 && (status === "queued" || status === "running"); i++) {
      const { result: report } = await captureConsole(() => drain({ maxJobs: 25, deadlineMs: 120_000 }));
      status = (await pg.json<string>(`select to_jsonb(status) from public.processing_runs where id = ${lit(runId)}`))!;
      t.diagnostic(`pass ${i}: ${JSON.stringify(report)} → run ${status}`);
      if (report.claimed === 0 && (status === "queued" || status === "running")) {
        // a retry is waiting for its backoff: make it due now (test-only acceleration of the real schedule)
        await pg.json(`select to_jsonb(count(*)) from (update public.processing_jobs set next_attempt_at = now() - interval '1 second'
                        where run_id = ${lit(runId)} and status = 'queued' and next_attempt_at > now() returning 1) x`);
      }
    }
    await captureConsole(() => flushAfter());
    const jobs = await pg.json(`select jsonb_agg(jsonb_build_object('stage', stage, 'src', source_id, 'status', status, 'attempt', attempt,
                                 'msg', error_message) order by created_at, id) from public.processing_jobs where run_id = ${lit(runId)}`);
    t.diagnostic(`jobs: ${JSON.stringify(jobs)}`);
    assert.equal(status, "succeeded", `run ${status}; jobs ${JSON.stringify(jobs)}`);
  });

  it("3. B4: the broken source failed alone, keeps its raw upload, and shows only a reason token", async () => {
    const rows = await pg.json<Array<{ id: string; state: string; raw: boolean; err: string | null }>>(
      `select jsonb_agg(jsonb_build_object('id', id, 'state', state, 'raw', raw_storage_path is not null, 'err', error_code))
         from public.sources where handover_id = ${lit(handoverId)}`);
    const by = (name: string) => rows.find((r) => r.id === ids[name])!;
    assert.deepEqual([by("chat.txt").state, by("chat.txt").raw], ["parsed", false], "chat parsed, raw deleted");
    assert.deepEqual([by("handbook.md").state, by("handbook.md").raw], ["parsed", false], "handbook parsed, raw deleted");
    assert.deepEqual([by("broken-export.txt").state, by("broken-export.txt").raw], ["failed", true], "broken source failed, raw kept for a retry");
    assert.match(by("broken-export.txt").err ?? "", /^[a-z_]+$/, "the source error is a reason token");
    const downstream = await pg.json<string[]>(`select coalesce(jsonb_agg(distinct status), '[]') from public.processing_jobs
      where run_id = ${lit(runId)} and source_id = ${lit(ids["broken-export.txt"])} and stage <> 'parse'`);
    assert.ok(downstream.every((s) => s === "skipped" || s === "cancelled" || s === "failed"), `downstream of the broken parse: ${downstream}`);
    assert.equal(await pg.json<string>(`select to_jsonb(state) from public.handovers where id = ${lit(handoverId)}`), "in_review");
    const persisted = await pg.json(`select jsonb_build_object(
      'messages', (select jsonb_agg(body) from public.source_messages where handover_id = ${lit(handoverId)}),
      'jobs', (select jsonb_agg(jsonb_build_object('m', error_message, 'log', attempt_log)) from public.processing_jobs where run_id = ${lit(runId)}),
      'handover', (select to_jsonb(last_error_message) from public.handovers where id = ${lit(handoverId)}))`);
    assertNoLeaks(persisted, "persisted after a partial failure");
    assert.doesNotMatch(JSON.stringify(persisted), /not a WhatsApp export|no dated lines/, "the broken file's text is never persisted");
  });

  it("4. B2: one owner point is conflicting with one supports and one contradicts link, one per source", async () => {
    const pts = await pg.json<Array<{ id: string; status: string; links: Array<{ v: string; src: string }> }>>(`
      select jsonb_agg(jsonb_build_object('id', p.id, 'status', p.evidence_status, 'links', (
               select jsonb_agg(jsonb_build_object('v', l.support_verdict, 'src', q.source_id))
                 from public.point_evidence l join public.evidence_quotes q on q.id = l.evidence_id where l.point_id = p.id)))
        from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id
       where p.handover_id = ${lit(handoverId)} and p.category = 'owner' and r.statement like '%bank signing mandate%'`);
    assert.equal(pts?.length, 1, `exactly one banking point: ${JSON.stringify(pts)}`);
    const [p] = pts;
    assert.equal(p.status, "conflicting");
    assert.deepEqual(p.links.map((l) => l.v).sort(), ["contradicts", "supports"]);
    assert.deepEqual(new Set(p.links.map((l) => l.src)), new Set([ids["chat.txt"], ids["handbook.md"]]), "one link per source");
    ids.point = p.id;
  });

  it("5. B2: approving the conflicting point needs a resolution note; resolving it approves it", async () => {
    signInAs(users.ann, "ann@example.test");
    const queries = getQueries();
    const point = ok(await queries.getPoint(ids.point), "getPoint");
    assert.equal(point.evidenceStatus, "conflicting");
    const plain = await reviewPoint({ action: "approve", pointId: point.id, expectedRevisionId: point.currentRevisionId });
    assert.ok(!plain.ok, "a conflicting point is not approved without a resolution");
    ok(await reviewPoint({ action: "approve", pointId: point.id, expectedRevisionId: point.currentRevisionId,
      resolutionNote: "The handbook is newer: the deadline is 31 January." }), "approve with resolution");
    const after = ok(await queries.getPoint(ids.point), "getPoint after");
    assert.equal(after.reviewState, "approved");
  });
});
