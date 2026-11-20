// Round 3 Task 05D Tier E (opt-in: BATON_IT_PG=1, needs Docker; `npm test` stays Docker-free).
//
// Deterministic change detection of a source update, through the real Server Functions, lib/db, lib/parsers,
// the lib/pipeline drainer (analyze → lib/pipeline/change-detection.ts) and the lib/ai fake adapter, on real Postgres:
//   1. a handover with two sources (a chat and a handbook) is processed and published (publication 1);
//   2. version 2 of the chat: one cited line unchanged, one re-posted at another time, one removed, plus a later
//      reversal and a new responsibility;
//   3. version 2 is processed by a scoped run (the handbook gets no job); detection classifies present / moved /
//      missing, a possible contradiction and new information; the update becomes `ready`;
//   4. the worker loses its claim right after recording detection: the job is reclaimed, detection runs again and
//      the item set is unchanged (no duplicates);
//   5. publication 1 is unchanged; publishing is blocked while items are open (every path, no acknowledgement helps);
//   6. version 3 supersedes version 2: its unresolved items become stale, nothing is deleted;
//   7. a never-published handover keeps its new points in the initial review (no new_information items).
//
//   BATON_IT_PG=1 BATON_IT_CONTAINER=baton-it-t05d node --import ./tests/integration/support/resolve.mjs \
//     --test tests/integration/r3-change-detection.test.ts
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
import type { DbClient, DbRpcResponse } from "../../lib/db/client";
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
const enc = (s: string) => new TextEncoder().encode(s);

// Synthetic WhatsApp exports (all names synthetic). Version 1: three cited responsibilities.
const CHAT_V1 = enc(
  [
    "05/01/2026, 18:00 - Asha Rao: Hi all, writing down the treasurer handover bits before I leave",
    "05/01/2026, 18:02 - Asha Rao: Asha Rao is responsible for the club bank signing mandate at the Indiranagar branch",
    "05/01/2026, 18:04 - Ravi Kumar: Ravi handles the sponsor reimbursements from the shared drive folder",
    "05/01/2026, 18:05 - Meera Iyer: Meera handles the lab cupboard keys with the lab assistant",
    "05/01/2026, 18:07 - Asha Rao: Great, thanks everyone",
    "",
  ].join("\n"),
);
// Version 2, a cumulative re-export: Asha's line unchanged; Ravi's line re-posted later; Meera's line gone;
// a later reversal of the bank mandate; a new responsibility.
const CHAT_V2 = enc(
  [
    "05/01/2026, 18:00 - Asha Rao: Hi all, writing down the treasurer handover bits before I leave",
    "05/01/2026, 18:02 - Asha Rao: Asha Rao is responsible for the club bank signing mandate at the Indiranagar branch",
    "05/01/2026, 18:07 - Asha Rao: Great, thanks everyone",
    "05/01/2026, 18:09 - Ravi Kumar: Ravi handles the sponsor reimbursements from the shared drive folder",
    "06/01/2026, 10:05 - Asha Rao: Actually the club bank signing mandate at the Indiranagar branch was moved to 15 April",
    "06/01/2026, 10:10 - Ravi Kumar: Ravi handles the sponsor thank-you letters from this term onwards",
    "",
  ].join("\n"),
);
const CHAT_V3 = enc(new TextDecoder().decode(CHAT_V2) + "07/01/2026, 09:00 - Asha Rao: One more note for the record\n");

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

describe("Tier E (R3 Task 05D): deterministic change detection of a source update", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-t05d-detect");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const handbook = new Uint8Array(readFileSync(join(DIR, "handbook.md")));
  let ann = "";
  let handoverId = "";
  const ids: Record<string, string> = {};
  const snapshots: Record<string, unknown> = {};

  /** Optionally loses the claim right AFTER detection was committed (a crash or lease expiry before the job completes). */
  let loseClaimAfterDetection = 0;
  const workerDb: DbClient = {
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<DbRpcResponse> {
      const res = await adminDb.rpc(fn, args);
      if (fn === "pipeline_record_change_detection" && !res.error && loseClaimAfterDetection > 0) {
        loseClaimAfterDetection -= 1;
        await pg.json(`with x as (update public.processing_jobs
                          set lease_expires_at = now() - interval '1 second', next_attempt_at = now() - interval '1 second'
                        where id = ${lit(String(args.p_job_id))} returning 1) select to_jsonb(count(*)) from x`);
        return { data: null, error: { code: "BTLL0", message: "claim lost" } };
      }
      return res;
    },
  };

  /** How often the drain fallback ran, and how many backed-off jobs it released (asserted where it is forced). */
  const fallbacks = { used: 0, released: 0 };
  const drainRun = async (runId: string) => {
    const drain = createDrainer({
      db: workerDb, storage, logger: createConsoleLogger(), getPepper: getVerifiedPepper,
      ai: { providerForRun: (rc) => getAiProviderForRun(rc), extractCandidates, verifySupport },
    });
    let status = "queued";
    for (let i = 0; i < 80 && (status === "queued" || status === "running"); i++) {
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
    pg.json<Array<{ stage: string; src: string | null; status: string; attempt: number }>>(
      `select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'src', source_id, 'status', status, 'attempt', attempt) order by stage, source_id), '[]')
         from public.processing_jobs where run_id = ${lit(runId)}`);
  const change = (sourceId: string) =>
    pg.json<{ id: string; state: string; err: string | null; base: string | null; detected: boolean; counts: Record<string, number> | null }>(
      `select jsonb_build_object('id', id, 'state', state, 'err', error_code, 'base', base_publication_id, 'detected', detected_at is not null,
                                 'counts', detection_counts) from public.source_version_changes where to_source_id = ${lit(sourceId)}`);
  const items = (sourceId: string) =>
    pg.json<Array<{ kind: string; state: string; point: string | null; old: string | null; msg: string | null; cand: string | null; key: string; detail: Record<string, unknown> }>>(
      `select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'state', i.state, 'point', i.point_id, 'old', i.old_evidence_id,
                                                    'msg', i.new_source_message_id, 'cand', i.candidate_point_id, 'key', i.dedupe_key, 'detail', i.detail)
                                 order by i.dedupe_key), '[]')
         from public.source_change_review_items i join public.source_version_changes c on c.id = i.change_id where c.to_source_id = ${lit(sourceId)}`);
  const snapshot = (publicationId: string) =>
    pg.json(`select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = ${lit(publicationId)}`);
  const sourceJobCount = (sourceId: string) =>
    pg.json<number>(`select to_jsonb(count(*)) from public.processing_jobs where source_id = ${lit(sourceId)}`);
  /** The point whose CURRENT statement contains `text` and that cites the given source (any version of it). */
  const pointCiting = (text: string, lineage: string) =>
    pg.json<string>(`select to_jsonb(p.id) from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id
                      where p.handover_id = ${lit(handoverId)} and r.statement like ${lit(`%${text}%`)}
                        and exists (select 1 from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                                     join public.sources s on s.id = q.source_id where pe.point_id = p.id and s.lineage_id = ${lit(lineage)})
                      order by p.created_at limit 1`);
  const evidenceOf = (pointId: string, sourceId: string) =>
    pg.json<string>(`select to_jsonb(q.id) from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                      where pe.point_id = ${lit(pointId)} and q.source_id = ${lit(sourceId)} limit 1`);

  async function upload(name: string, kind: "whatsapp_export" | "markdown", mime: string, bytes: Uint8Array, hId = handoverId) {
    const t = ok(await createSourceUpload({ handoverId: hId, kind, fileName: name, mimeType: mime, sizeBytes: bytes.byteLength, sha256: sha(bytes) }), `upload ${name}`);
    await storage.upload(SOURCE_BUCKET, `raw/${hId}/${t.sourceId}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: t.sourceId }), `confirm ${name}`);
    ok(await recordSourceConsent({ sourceId: t.sourceId, consentStatementVersion: "local-test-2026-11-18-v1", consentConfirmed: true, accessLevel: "everyone",
      timezone: "Asia/Kolkata", ...(kind === "whatsapp_export" ? { dateOrder: "dmy" as const } : {}) }), `consent ${name}`);
    return t.sourceId;
  }
  async function uploadVersion(previousSourceId: string, bytes: Uint8Array, hId = handoverId) {
    const r = ok(await createSourceVersionUpload({ previousSourceId, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain",
      sizeBytes: bytes.byteLength, sha256: sha(bytes) }), "version upload");
    assert.equal(r.status, "upload");
    const id = r.status === "upload" ? r.ticket.sourceId : "";
    await storage.upload(SOURCE_BUCKET, `raw/${hId}/${id}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: id }), "confirm version");
    ok(await recordSourceConsent({ sourceId: id, consentStatementVersion: "local-test-2026-11-18-v1", consentConfirmed: true, timezone: "Asia/Kolkata" }), "consent version");
    return id;
  }
  /** Approve every pending point and accept required gap answers (the ordinary review). */
  async function reviewEverything(hId = handoverId) {
    const queries = getQueries();
    const open = ok(await queries.listGapQuestions(hId), "gaps").filter((q) => q.status === "open" && q.priority === "required");
    if (open.length > 0) {
      ok(await submitGapAnswers({ answers: open.map((q) => ({ gapQuestionId: q.id, answerText: "Ravi handles this; see the shared drive." })) }), "answers");
      for (const q of ok(await queries.listGapQuestions(hId), "gaps")) {
        for (const a of q.answers.filter((x) => x.status === "submitted")) ok(await reviewGapAnswer({ answerId: a.id, decision: "accept" }), "accept");
      }
    }
    for (const summary of ok(await queries.listPoints(hId), "points").filter((p) => p.reviewState === "pending")) {
      const p = ok(await queries.getPoint(summary.id), "point");
      ok(await reviewPoint({
        action: "approve", pointId: p.id, expectedRevisionId: p.currentRevisionId,
        ...(p.evidenceStatus === "inferred" ? { confirmInferred: true } : {}),
        ...(p.evidenceStatus === "conflicting" ? { resolutionNote: "Checked." } : {}),
        ...(p.evidenceStatus === "missing" ? { asKnownGap: true } : {}),
      }), `approve ${p.evidenceStatus}`);
    }
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

  it("1. a handover with two sources is processed and published", async () => {
    signInAs(ann, "ann@example.test");
    handoverId = ok(await createHandover({ title: "Living handover", teamName: "Synthetic Robotics Club", roleTitle: "Treasurer", creatorRole: "outgoing" }), "createHandover").id;
    ids.chat = await upload("chat.txt", "whatsapp_export", "text/plain", CHAT_V1);
    ids.handbook = await upload("handbook.md", "markdown", "text/markdown", handbook);
    ids.run1 = ok(await startProcessing({ handoverId }), "process").runId;
    assert.equal(await drainRun(ids.run1), "succeeded");
    ok(await inviteMember({ handoverId, email: "inc@example.test", role: "incoming", expiresInDays: 7 }), "invite");
    await reviewEverything();
    assert.ok(ok(await getQueries().getReadiness(handoverId), "readiness").canPublish, "ready before any update");
    ids.pub1 = ok(await publishHandover({ handoverId, summary: "Version 1." }), "publish 1").publicationId;
    snapshots.pub1 = await snapshot(ids.pub1);
    ids.asha = (await pointCiting("bank signing mandate", ids.chat))!;
    ids.ravi = (await pointCiting("sponsor reimbursements", ids.chat))!;
    ids.meera = (await pointCiting("lab cupboard keys", ids.chat))!;
    assert.ok(ids.asha && ids.ravi && ids.meera, "three chat points were extracted and published");
    ids.eAsha = (await evidenceOf(ids.asha, ids.chat))!;
    ids.eRavi = (await evidenceOf(ids.ravi, ids.chat))!;
    ids.eMeera = (await evidenceOf(ids.meera, ids.chat))!;
    snapshots.v1evidence = await pg.json(`select jsonb_agg(to_jsonb(q) order by q.id) from public.evidence_quotes q where q.source_id = ${lit(ids.chat)}`);
  });

  it("2. version 2 of the chat waits for processing and blocks publication", async () => {
    signInAs(ann, "ann@example.test");
    ok(await startRevision({ handoverId }), "start revision");
    ids.v2 = await uploadVersion(ids.chat, CHAT_V2);
    assert.equal((await change(ids.v2))!.state, "awaiting_processing");
    assert.equal((await change(ids.v2))!.base, ids.pub1, "the update records publication 1 as its baseline");
    const readiness = ok(await getQueries().getReadiness(handoverId), "readiness");
    assert.ok(!readiness.canPublish && readiness.blockers.some((b) => b.kind === "source_updates_pending"), "readiness reports the pending update");
  });

  it("3. scoped processing and detection: present, moved, missing, contradiction, new information", async () => {
    signInAs(ann, "ann@example.test");
    const handbookJobs = await sourceJobCount(ids.handbook);
    const pointsBefore = (await pg.json<number>(`select to_jsonb(count(*)) from public.handover_points where handover_id = ${lit(handoverId)}`))!;
    ids.run2 = ok(await startProcessing({ handoverId }), "scoped run").runId;
    loseClaimAfterDetection = 1; // step 4: the first detection commit is followed by a lost claim
    assert.equal(await drainRun(ids.run2), "succeeded", JSON.stringify(await pg.json(`select jsonb_agg(jsonb_build_object('stage', stage, 'status', status,
      'attempt', attempt, 'code', error_code, 'msg', error_message)) from public.processing_jobs where run_id = ${lit(ids.run2)}`)));
    const jobs = (await jobsOf(ids.run2))!;
    assert.ok(jobs.filter((j) => j.src !== null).every((j) => j.src === ids.v2), "source-specific work only for version 2");
    assert.equal(await sourceJobCount(ids.handbook), handbookJobs, "the untouched handbook received no job");

    const c = (await change(ids.v2))!;
    assert.equal(c.state, "ready", "fully evaluated");
    assert.equal(c.detected, true);
    const list = (await items(ids.v2))!;
    const of = (kind: string) => list.filter((i) => i.kind === kind);
    // present: Asha's unchanged line creates no evidence item
    assert.equal(list.filter((i) => i.old === ids.eAsha && (i.kind === "evidence_missing" || i.kind === "evidence_moved")).length, 0,
      "evidence still present: no item, although the message id changed");
    // moved: Ravi's re-posted line
    const moved = of("evidence_moved").filter((i) => i.old === ids.eRavi);
    assert.equal(moved.length, 1, JSON.stringify(list));
    assert.equal(moved[0].point, ids.ravi);
    assert.ok(moved[0].msg, "mapped to the new message");
    assert.equal(moved[0].detail.location, "time_changed");
    assert.equal(await pg.json<string>(`select to_jsonb(source_id) from public.source_messages where id = ${lit(moved[0].msg!)}`), ids.v2);
    // missing: Meera's removed line
    const missing = of("evidence_missing").filter((i) => i.old === ids.eMeera);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].detail.match, "not_found");
    // a later reversal of the bank mandate
    assert.ok(of("possible_contradiction").some((i) => i.point === ids.asha), "the reversal is a possible contradiction of Asha's point");
    // new information: the new responsibility, as the existing pending candidate point
    const ni = of("new_information");
    assert.equal(ni.length, 1, JSON.stringify(ni));
    const candidate = await pg.json<{ state: string; statement: string }>(
      `select jsonb_build_object('state', p.review_state, 'statement', r.statement) from public.handover_points p
         join public.point_revisions r on r.id = p.current_revision_id where p.id = ${lit(ni[0].cand!)}`);
    assert.equal(candidate!.state, "pending", "the candidate stays pending (never approved by detection)");
    assert.match(candidate!.statement, /thank-you letters/);
    assert.equal(ni[0].detail.coverage, "after_watermark");
    // nothing was rewritten, removed or duplicated
    assert.equal((await pg.json<number>(`select to_jsonb(count(*)) from public.handover_points where handover_id = ${lit(handoverId)}`))! - pointsBefore, 1,
      "only the new responsibility became a new point (re-extraction merged into the existing points)");
    for (const p of [ids.asha, ids.ravi, ids.meera]) {
      assert.equal(await pg.json<string>(`select to_jsonb(review_state) from public.handover_points where id = ${lit(p)}`), "approved", "decisions kept");
    }
    assert.ok((await pg.json<number>(`select to_jsonb(count(*)) from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                                       where pe.point_id = ${lit(ids.asha)} and q.source_id = ${lit(ids.v2)}`))! >= 1,
      "Asha's existing point received the new version's evidence (the same point)");
    assert.deepEqual(await pg.json(`select jsonb_agg(to_jsonb(q) order by q.id) from public.evidence_quotes q where q.source_id = ${lit(ids.chat)}`),
      snapshots.v1evidence, "version 1's evidence is untouched (missing evidence is kept as history)");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.point_evidence where evidence_id = ${lit(ids.eMeera)} and excluded_at is null`), 1,
      "the missing evidence's link is still active");
    assert.ok(!JSON.stringify(list.map((i) => i.detail)).match(/Meera|Ravi|Asha|sponsor|mandate|cupboard/i), "item details carry no message text or names");
    snapshots.items = list;
  });

  it("4. a lost claim after the detection commit: reclaimed, detected again, the same items", async () => {
    const analyze = (await jobsOf(ids.run2))!.find((j) => j.stage === "analyze")!;
    assert.equal(analyze.status, "succeeded");
    assert.ok(analyze.attempt >= 2, "the analyze job was reclaimed after the lost claim");
    const audits = (await pg.json<Array<{ inserted: number; repeat: boolean }>>(
      `select jsonb_agg(jsonb_build_object('inserted', (after ->> 'inserted')::int, 'repeat', (after ->> 'repeat')::boolean) order by id)
         from public.audit_logs where action = 'source_update.changes_detected' and entity_id = ${lit((await change(ids.v2))!.id)}`))!;
    assert.equal(audits.length, 2, "detection ran twice");
    assert.equal(audits[0].inserted, snapshots.items ? (snapshots.items as unknown[]).length : -1, "the first run inserted every item");
    assert.deepEqual(audits[1], { inserted: 0, repeat: true }, "the retry inserted nothing");
    assert.deepEqual(await items(ids.v2), snapshots.items, "the item set is unchanged");
  });

  it("5. publication 1 is unchanged; publishing is blocked on every path while items are open", async () => {
    signInAs(ann, "ann@example.test");
    assert.deepEqual(await snapshot(ids.pub1), snapshots.pub1, "publication 1 is byte-for-byte unchanged");
    await reviewEverything(); // the new candidate point is decided in the ordinary review
    const readiness = ok(await getQueries().getReadiness(handoverId), "readiness");
    assert.deepEqual(readiness.blockers.map((b) => b.kind), ["change_reviews_open"], "only the change reviews remain");
    assert.equal(readiness.canPublish, false, "readiness never says ready");
    const refused = await publishHandover({ handoverId, acknowledgeExtractionGaps: true });
    assert.equal(!refused.ok && refused.error.details?.reason, "change_review_open", JSON.stringify(refused));
    assert.ok(!refused.ok && /needs? a decision/.test(refused.error.message), "the reviewer is told why");
    await assert.rejects(pg.json(`select to_jsonb(public.publish_handover(${lit(ann)}, ${lit(handoverId)}, null))`), /change_review_open|not ready/,
      "the database refuses the direct path");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.handover_publications where handover_id = ${lit(handoverId)}`), 1, "no publication");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.publication_source_acknowledgements where handover_id = ${lit(handoverId)}`), 0,
      "no acknowledgement left behind");
    const report = ok(await getQueries().getExtractionReport(handoverId), "report");
    const u = report.sourceUpdates.find((x) => x.sourceId === ids.v2)!;
    assert.equal(u.state, "ready");
    assert.equal(u.openReviewItems, (snapshots.items as unknown[]).length);
    assert.equal(u.blocksPublication, true);
  });

  it("6. version 3 supersedes version 2: unresolved items become stale; nothing is deleted", async () => {
    signInAs(ann, "ann@example.test");
    ids.v3 = await uploadVersion(ids.v2, CHAT_V3);
    assert.equal((await change(ids.v2))!.state, "superseded");
    const list = (await items(ids.v2))!;
    assert.equal(list.length, (snapshots.items as unknown[]).length, "no item deleted");
    assert.ok(list.every((i) => i.state === "stale"), "every unresolved item of version 2 is stale");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public._blocking_change_reviews(${lit(handoverId)})`), 0, "stale items do not block");
    assert.equal((await change(ids.v3))!.state, "awaiting_processing", "version 3 itself waits (and blocks)");
    assert.deepEqual(await snapshot(ids.pub1), snapshots.pub1, "publication 1 is unchanged");
  });

  it("7. a never-published handover: new points stay in the initial review, no new_information item", async () => {
    signInAs(ann, "ann@example.test");
    const h2 = ok(await createHandover({ title: "Unpublished", teamName: "Synthetic Chess Club", roleTitle: "Secretary", creatorRole: "outgoing" }), "h2").id;
    const s = await upload("chat.txt", "whatsapp_export", "text/plain", enc(new TextDecoder().decode(CHAT_V1).replace(/Hi all/, "Hello all")), h2);
    assert.equal(await drainRun(ok(await startProcessing({ handoverId: h2 }), "process h2").runId), "succeeded");
    const v2 = await uploadVersion(s, enc(new TextDecoder().decode(CHAT_V2).replace(/Hi all/, "Hello all")), h2);
    assert.equal((await change(v2))!.base, null, "no baseline publication");
    assert.equal(await drainRun(ok(await startProcessing({ handoverId: h2 }), "scoped h2").runId), "succeeded");
    assert.equal((await change(v2))!.state, "ready");
    const list = (await items(v2))!;
    assert.equal(list.filter((i) => i.kind === "new_information").length, 0, "no new_information item without a publication");
    assert.ok((await pg.json<number>(`select to_jsonb(count(*)) from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id
                                       where p.handover_id = ${lit(h2)} and p.review_state = 'pending' and r.statement like '%thank-you letters%'`))! === 1,
      "the new point is simply pending in the ordinary review");
  });
});
