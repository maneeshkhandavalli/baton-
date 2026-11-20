// Round 3 Task 05C Tier E (opt-in: BATON_IT_PG=1, needs Docker; `npm test` stays Docker-free).
//
// Scoped processing of a source update and the publication gate, through the real Server Functions, lib/db,
// lib/parsers, the lib/pipeline drainer and the lib/ai fake adapter, on real Postgres:
//   1. two sources (a chat and a handbook) are processed in full and published (publication 1);
//   2. a revision adds a BROKEN new version of the chat: publication is blocked while it waits; a duplicate
//      upload and a stale one are refused;
//   3. processing it is scoped: only the new version gets parse/extract/verify_quotes, the handbook is untouched,
//      every handover-wide stage is planned; a repeated request cannot start a second run; it fails, is retried
//      (same update record), fails again;
//   4. a failed update goes through Task 04's explicit acknowledgement (publication 2) and stays `failed`;
//   5. a GOOD next version is processed (scoped again, handover-wide stages succeed) and then waits for change
//      detection (Task 05D): publication stays blocked on every path. Publications 1 and 2 never change.
//
//   BATON_IT_PG=1 BATON_IT_CONTAINER=baton-it-t05c node --import ./tests/integration/support/resolve.mjs \
//     --test tests/integration/r3-scoped-version-processing.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getAiProviderForRun } from "../../lib/ai/config";
import { extractCandidates } from "../../lib/ai/extract";
import { verifySupport } from "../../lib/ai/verify-support";
import { reviewGapAnswer, submitGapAnswers } from "../../lib/actions/gaps";
import { createHandover, publishHandover, startProcessing, startRevision } from "../../lib/actions/handovers";
import { inviteMember } from "../../lib/actions/members";
import { reviewPoint } from "../../lib/actions/review";
import { confirmSourceUploaded, createSourceUpload, createSourceVersionUpload, recordSourceConsent } from "../../lib/actions/sources";
import { getQueries } from "../../lib/data";
import { SOURCE_BUCKET } from "../../lib/db/storage";
import { createConsoleLogger } from "../../lib/pipeline/log";
import { getVerifiedPepper } from "../../lib/pipeline/pepper";
import { createDrainer } from "../../lib/pipeline/runner";
import { computeIdentityPepperCanary } from "../../lib/privacy/identity";
import { TEST_PEPPER } from "../../fixtures/parser/load";
import { releaseBackedOffJobs } from "./support/backoff";
import { captureConsole } from "./support/console-capture";
import { PgBackedStorage, PgContainer, PsqlDbClient, lit } from "./support/pg";
import { allowFakeAi, currentUserId, flushAfter, installCustomBackends, resetPlatform, signInAs } from "./support/platform";

const ENABLED = process.env.BATON_IT_PG === "1";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "round3-conflict");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const BROKEN = new TextEncoder().encode("This is not a WhatsApp export.\nNo dated lines at all.\n");

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

describe("Tier E (R3 Task 05C): scoped processing of a source update and the publication gate", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-t05c-scoped");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const chat = new Uint8Array(readFileSync(join(DIR, "chat.txt")));
  const handbook = new Uint8Array(readFileSync(join(DIR, "handbook.md")));
  const chatV3 = new TextEncoder().encode(
    new TextDecoder().decode(chat).replace(/\s*$/, "\n") + "06/01/2026, 10:05 - Asha Rao: The bank signing mandate submission was moved to 15 April\n",
  );
  let ann = "";
  let handoverId = "";
  const ids: Record<string, string> = {};
  const snapshots: Record<string, unknown> = {};

  /** How often the drain fallback ran, and how many backed-off jobs it released (asserted where it is forced). */
  const fallbacks = { used: 0, released: 0 };
  const drainRun = async (runId: string) => {
    const drain = createDrainer({
      db: adminDb, storage, logger: createConsoleLogger(), getPepper: getVerifiedPepper,
      ai: { providerForRun: (rc) => getAiProviderForRun(rc), extractCandidates, verifySupport },
    });
    let status = "queued";
    for (let i = 0; i < 60 && (status === "queued" || status === "running"); i++) {
      const { result: report } = await captureConsole(() => drain({ maxJobs: 25, deadlineMs: 120_000 }));
      status = (await pg.json<string>(`select to_jsonb(status) from public.processing_runs where id = ${lit(runId)}`))!;
      if (report.claimed === 0 && (status === "queued" || status === "running")) {
        fallbacks.released += await releaseBackedOffJobs(pg, runId);
        fallbacks.used += 1;
      }
    }
    await captureConsole(() => flushAfter());
    return status;
  };
  const jobsOf = (runId: string) =>
    pg.json<Array<{ stage: string; src: string | null; status: string }>>(
      `select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'src', source_id, 'status', status) order by stage, source_id), '[]')
         from public.processing_jobs where run_id = ${lit(runId)}`);
  const change = (sourceId: string) =>
    pg.json<{ state: string; err: string | null; n: number }>(
      `select jsonb_build_object('state', max(state), 'err', max(error_code), 'n', count(*)) from public.source_version_changes where to_source_id = ${lit(sourceId)}`);
  const snapshot = (publicationId: string) =>
    pg.json(`select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = ${lit(publicationId)}`);
  const sourceJobCount = (sourceId: string) =>
    pg.json<number>(`select to_jsonb(count(*)) from public.processing_jobs where source_id = ${lit(sourceId)}`);
  async function upload(name: string, kind: "whatsapp_export" | "markdown", mime: string, bytes: Uint8Array) {
    const t = ok(await createSourceUpload({ handoverId, kind, fileName: name, mimeType: mime, sizeBytes: bytes.byteLength, sha256: sha(bytes) }), `upload ${name}`);
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${t.sourceId}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: t.sourceId }), `confirm ${name}`);
    ok(await recordSourceConsent({ sourceId: t.sourceId, consentStatementVersion: "local-test-2026-11-18-v1", consentConfirmed: true, accessLevel: "everyone",
      timezone: "Asia/Kolkata", ...(kind === "whatsapp_export" ? { dateOrder: "dmy" as const } : {}) }), `consent ${name}`);
    return t.sourceId;
  }
  async function uploadVersion(previousSourceId: string, bytes: Uint8Array) {
    const r = ok(await createSourceVersionUpload({ previousSourceId, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain",
      sizeBytes: bytes.byteLength, sha256: sha(bytes) }), "version upload");
    assert.equal(r.status, "upload");
    const id = r.status === "upload" ? r.ticket.sourceId : "";
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${id}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: id }), "confirm version");
    ok(await recordSourceConsent({ sourceId: id, consentStatementVersion: "local-test-2026-11-18-v1", consentConfirmed: true, timezone: "Asia/Kolkata" }), "consent version");
    return id;
  }
  /** Approve every pending point and accept required gap answers (as in the other Tier E suites). */
  async function makeReady(requireReady = true) {
    const queries = getQueries();
    const open = ok(await queries.listGapQuestions(handoverId), "gaps").filter((q) => q.status === "open" && q.priority === "required");
    if (open.length > 0) {
      ok(await submitGapAnswers({ answers: open.map((q) => ({ gapQuestionId: q.id, answerText: "Ravi handles this; see the shared drive." })) }), "answers");
      for (const q of ok(await queries.listGapQuestions(handoverId), "gaps")) {
        for (const a of q.answers.filter((x) => x.status === "submitted")) ok(await reviewGapAnswer({ answerId: a.id, decision: "accept" }), "accept");
      }
    }
    for (const summary of ok(await queries.listPoints(handoverId), "points").filter((p) => p.reviewState === "pending")) {
      const p = ok(await queries.getPoint(summary.id), "point");
      ok(await reviewPoint({
        action: "approve", pointId: p.id, expectedRevisionId: p.currentRevisionId,
        ...(p.evidenceStatus === "inferred" ? { confirmInferred: true } : {}),
        ...(p.evidenceStatus === "conflicting" ? { resolutionNote: "Checked." } : {}),
        ...(p.evidenceStatus === "missing" ? { asKnownGap: true } : {}),
      }), `approve ${p.evidenceStatus}`);
    }
    if (requireReady) assert.ok(ok(await queries.getReadiness(handoverId), "readiness").canPublish, "readiness itself is satisfied");
  }

  before(async () => {
    if (!ENABLED) return;
    await pg.start();
    resetPlatform();
    allowFakeAi();
    process.env.IDENTITY_PEPPER = TEST_PEPPER;
    process.env.IDENTITY_MAP_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"; // synthetic
    process.env.IDENTITY_MAP_KEY_VERSION = "k1";
    process.env.IDENTITY_PEPPER_VERSION = "p1";
    process.env.IDENTITY_PEPPER_CANARY = computeIdentityPepperCanary(TEST_PEPPER);
    installCustomBackends({ adminDb, userDb, adminStorage: storage, userStorage: storage });
    ann = (await pg.json<string>(`select to_jsonb(tests.user('ann'))`))!;
  });

  after(async () => {
    if (ENABLED) await pg.stop();
  });

  it("1. two sources are processed in full and published", async () => {
    signInAs(ann, "ann@example.test");
    handoverId = ok(await createHandover({ title: "Living handover", teamName: "Synthetic Robotics Club", roleTitle: "Treasurer", creatorRole: "outgoing" }), "createHandover").id;
    ids.chat = await upload("chat.txt", "whatsapp_export", "text/plain", chat);
    ids.handbook = await upload("handbook.md", "markdown", "text/markdown", handbook);
    ids.run1 = ok(await startProcessing({ handoverId }), "process").runId;
    assert.equal(await drainRun(ids.run1), "succeeded");
    assert.ok((await jobsOf(ids.run1))!.some((j) => j.stage === "extract" && j.src === ids.handbook), "a full run extracts every source");
    ok(await inviteMember({ handoverId, email: "inc@example.test", role: "incoming", expiresInDays: 7 }), "invite");
    await makeReady();
    ids.pub1 = ok(await publishHandover({ handoverId, summary: "Version 1." }), "publish 1").publicationId;
    snapshots.pub1 = await snapshot(ids.pub1);
    assert.ok(snapshots.pub1, "publication 1 has points");
  });

  it("2. a new version waits for processing and blocks publication; duplicate and stale uploads are refused", async () => {
    signInAs(ann, "ann@example.test");
    ok(await startRevision({ handoverId }), "start revision");
    ids.v2 = await uploadVersion(ids.chat, BROKEN);
    assert.deepEqual(await change(ids.v2), { state: "awaiting_processing", err: null, n: 1 });
    const refused = await publishHandover({ handoverId });
    assert.ok(!refused.ok && refused.error.details?.reason === "source_update_pending", JSON.stringify(refused));
    assert.ok(!refused.ok && /hasn.t been processed yet/.test(refused.error.message), "the reviewer is told what to do");
    await assert.rejects(pg.json(`select to_jsonb(public.publish_handover(${lit(ann)}, ${lit(handoverId)}, null))`), /source_update_pending|not ready/,
      "a path that skips the action is refused too");
    assert.deepEqual(ok(await createSourceVersionUpload({ previousSourceId: ids.v2, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain",
      sizeBytes: BROKEN.byteLength, sha256: sha(BROKEN) }), "duplicate"), { status: "unchanged", sourceId: ids.v2 });
    const stale = await createSourceVersionUpload({ previousSourceId: ids.chat, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain",
      sizeBytes: chatV3.byteLength, sha256: sha(chatV3) });
    assert.equal(!stale.ok && stale.error.details?.reason, "stale");
  });

  it("3. processing is scoped to the new version; a repeated request is refused; failure and retry keep one record", async () => {
    signInAs(ann, "ann@example.test");
    const handbookJobs = await sourceJobCount(ids.handbook);
    ids.run2 = ok(await startProcessing({ handoverId }), "scoped run").runId;
    const repeated = await startProcessing({ handoverId });
    assert.ok(!repeated.ok, "a repeated request cannot start a second run");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.processing_runs where handover_id = ${lit(handoverId)} and status in ('queued','running')`), 1);
    const jobs = (await jobsOf(ids.run2))!;
    assert.deepEqual(jobs.map((j) => `${j.stage}:${j.src === ids.v2 ? "v2" : j.src === null ? "-" : "other"}`).sort(),
      ["analyze:-", "extract:v2", "parse:v2", "prepare_review:-", "verify_quotes:v2", "verify_support:-"],
      "source-specific jobs only for the new version, every handover-wide stage planned");
    assert.deepEqual(await pg.json(`select to_jsonb(source_ids) from public.processing_runs where id = ${lit(ids.run2)}`), [ids.handbook, ids.v2],
      "the run covers the current sources (oldest first), never version 1");
    assert.deepEqual(await change(ids.v2), { state: "processing", err: null, n: 1 });
    assert.equal(await drainRun(ids.run2), "failed", "the only processed source could not be read");
    assert.deepEqual(await change(ids.v2), { state: "failed", err: "extraction_failed", n: 1 });
    // retry: the same record goes back to processing, then fails again
    ids.run3 = ok(await startProcessing({ handoverId }), "retry").runId;
    assert.deepEqual(await change(ids.v2), { state: "processing", err: null, n: 1 });
    // R3 Task 05E hardening: force the drain helper's fallback path. Every job of this run starts in a backoff, so
    // the first drain claims nothing and the fallback (releaseBackedOffJobs) must make them due; before the fix the
    // fallback was invalid SQL and only the normal claimable path was ever exercised.
    const delayed = (await pg.json<number>(`with d as (update public.processing_jobs set next_attempt_at = now() + interval '1 hour'
                                              where run_id = ${lit(ids.run3)} and status = 'queued' returning 1) select to_jsonb(count(*)) from d`))!;
    assert.ok(delayed > 0, "the run's jobs are backed off");
    const before = { ...fallbacks };
    assert.equal(await drainRun(ids.run3), "failed");
    assert.ok(fallbacks.used > before.used, "the fallback ran");
    assert.ok(fallbacks.released - before.released >= 1, "and released the backed-off jobs");
    assert.deepEqual(await change(ids.v2), { state: "failed", err: "extraction_failed", n: 1 }, "a retry never duplicates the record");
    assert.equal(await sourceJobCount(ids.handbook), handbookJobs, "the handbook was never parsed or extracted again");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.processing_jobs where source_id = ${lit(ids.chat)} and run_id <> ${lit(ids.run1)}`), 0,
      "no later run touched version 1");
    assert.equal(await pg.json<string>(`select to_jsonb(state) from public.handovers where id = ${lit(handoverId)}`), "in_review");
  });

  it("4. the failed update needs Task 04's acknowledgement; publishing with it never marks the update verified", async () => {
    signInAs(ann, "ann@example.test");
    await makeReady();
    const refused = await publishHandover({ handoverId });
    assert.equal(!refused.ok && refused.error.details?.reason, "extraction_incomplete", "the explicit acknowledgement is required");
    ids.pub2 = ok(await publishHandover({ handoverId, summary: "Version 2.", acknowledgeExtractionGaps: true }), "publish 2").publicationId;
    assert.deepEqual(await change(ids.v2), { state: "failed", err: "extraction_failed", n: 1 }, "still failed after publishing");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.audit_logs where entity_id = ${lit(ids.pub2)}
                                         and action = 'publication.source_updates_unverified'`), 1, "the publication records the unverified update");
    assert.deepEqual(await snapshot(ids.pub1), snapshots.pub1, "publication 1 is unchanged");
    snapshots.pub2 = await snapshot(ids.pub2);
  });

  it("5. a good next version is processed (scoped) and checked (Task 05D); its open change review keeps publication blocked", async () => {
    signInAs(ann, "ann@example.test");
    ok(await startRevision({ handoverId }), "start revision");
    ids.v3 = await uploadVersion(ids.v2, chatV3);
    assert.deepEqual(await change(ids.v2), { state: "superseded", err: "extraction_failed", n: 1 }, "the failed update is superseded");
    const handbookJobs = await sourceJobCount(ids.handbook);
    ids.run4 = ok(await startProcessing({ handoverId }), "scoped run").runId;
    assert.equal(await drainRun(ids.run4), "succeeded");
    const jobs = (await jobsOf(ids.run4))!;
    assert.ok(jobs.filter((j) => j.src !== null).every((j) => j.src === ids.v3), "source-specific work only for version 3");
    assert.deepEqual(jobs.filter((j) => j.src === null).map((j) => `${j.stage}:${j.status}`).sort(),
      ["analyze:succeeded", "prepare_review:succeeded", "verify_support:succeeded"], "every handover-wide stage ran");
    assert.equal(await sourceJobCount(ids.handbook), handbookJobs, "the handbook is untouched");
    // Task 05D: the analyze job compared version 3 with the lineage's retained evidence (version 1's, since version 2
    // never parsed) and recorded detection, so the update is fully evaluated: ready. The added line reverses the bank
    // mandate, so a change review is open and still blocks publication.
    assert.deepEqual(await change(ids.v3), { state: "ready", err: null, n: 1 }, "processed and checked (Task 05D)");
    assert.ok((await pg.json<number>(`select to_jsonb(count(*)) from public.source_messages where source_id = ${lit(ids.v3)}`))! > 0, "version 3 was parsed");
    const open = (await pg.json<number>(`select to_jsonb(count(*)) from public.source_change_review_items i join public.source_version_changes c
                                           on c.id = i.change_id where c.to_source_id = ${lit(ids.v3)} and i.state = 'open'`))!;
    assert.ok(open > 0, "the reversal is an open change review");

    await makeReady(false);
    const refused = await publishHandover({ handoverId, acknowledgeExtractionGaps: true });
    assert.equal(!refused.ok && refused.error.details?.reason, "change_review_open", "no acknowledgement lifts it");
    await assert.rejects(pg.json(`select to_jsonb(public.publish_handover(${lit(ann)}, ${lit(handoverId)}, null))`), /change_review_open|not ready/,
      "the database refuses the direct path");
    assert.equal(await pg.json<string>(`select to_jsonb(state) from public.handovers where id = ${lit(handoverId)}`), "in_review");
    assert.deepEqual(await snapshot(ids.pub1), snapshots.pub1, "publication 1 is unchanged");
    assert.deepEqual(await snapshot(ids.pub2), snapshots.pub2, "publication 2 is unchanged");
    assert.equal(await pg.json<string>(`select to_jsonb(current_publication_id) from public.handovers where id = ${lit(handoverId)}`), ids.pub2,
      "the incoming member keeps the last publication");
  });
});
