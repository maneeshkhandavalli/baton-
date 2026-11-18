// Round 3 Task 05E Tier E (opt-in: BATON_IT_PG=1, needs Docker; `npm test` stays Docker-free).
//
// The reviewer decision workflow for change-review items, through the real Server Functions (decideChangeReview,
// publishHandover, …), lib/db, the pipeline drainer and the fake AI adapter, on real Postgres:
//   1. a chat with four cited responsibilities (+ a handbook) is processed and published (publication 1);
//   2. version 2 moves two lines, drops one, reverses two and adds two responsibilities → detected items;
//   3. unauthorized users can neither read nor decide;
//   4. investigate a missing quotation: publishing stays blocked (also with the extraction acknowledgement);
//   5. moved: accept links the relocated quotation; reject leaves the point untouched;
//   6. contradiction: accept = the reviewer's correction (new revision) + a quotation from the new version; reject keeps it;
//   7. new information: accept approves the candidate through the normal review; reject rejects it, no stray rows;
//   8. missing: a re-attestation with a note, no replacement evidence;
//   9. everything resolved → the normal publication path; publication 1 unchanged, publication 2 carries the decisions;
//  10. version 3: two concurrent decisions on one item (one wins), a decision on a changed point is refused, and after
//      version 4 the undecided item is stale and cannot be decided.
//
//   BATON_IT_PG=1 BATON_IT_CONTAINER=baton-it-t05e node --import ./tests/integration/support/resolve.mjs \
//     --test tests/integration/r3-change-review-decisions.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getAiProviderForRun } from "../../lib/ai/config";
import { extractCandidates } from "../../lib/ai/extract";
import { verifySupport } from "../../lib/ai/verify-support";
import { decideChangeReview } from "../../lib/actions/change-reviews";
import { reviewGapAnswer, submitGapAnswers } from "../../lib/actions/gaps";
import { createHandover, publishHandover, startProcessing, startRevision } from "../../lib/actions/handovers";
import { inviteMember } from "../../lib/actions/members";
import { reviewPoint } from "../../lib/actions/review";
import { confirmSourceUploaded, createSourceUpload, createSourceVersionUpload, recordSourceConsent } from "../../lib/actions/sources";
import type { ChangeReviewItem, ChangeReviewKind, DecideChangeReviewInput } from "../../lib/contracts/change-review";
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
const enc = (s: string) => new TextEncoder().encode(s);
const STATEMENT = "local-test-2026-11-18-v1";

const lines = (xs: string[]) => enc([...xs, ""].join("\n"));
const V1 = [
  "05/01/2026, 18:00 - Asha Rao: Hi all, writing down the treasurer handover bits before I leave",
  "05/01/2026, 18:02 - Asha Rao: Asha Rao is responsible for the club bank signing mandate at the Indiranagar branch",
  "05/01/2026, 18:03 - Kiran Das: Kiran handles the hall booking deposits with the college office",
  "05/01/2026, 18:04 - Ravi Kumar: Ravi handles the sponsor reimbursements from the shared drive folder",
  "05/01/2026, 18:05 - Meera Iyer: Meera handles the lab cupboard keys with the lab assistant",
  "05/01/2026, 18:07 - Asha Rao: Great, thanks everyone",
];
const V2 = [
  V1[0], V1[1], V1[5],
  "05/01/2026, 18:08 - Kiran Das: Kiran handles the hall booking deposits with the college office",
  "05/01/2026, 18:09 - Ravi Kumar: Ravi handles the sponsor reimbursements from the shared drive folder",
  "06/01/2026, 10:05 - Asha Rao: Actually the club bank signing mandate at the Indiranagar branch was moved to Kiran from 15 April",
  "06/01/2026, 10:07 - Kiran Das: Actually the hall booking deposits with the college office were postponed to May",
  "06/01/2026, 10:10 - Ravi Kumar: Ravi handles the sponsor thank-you letters from this term onwards",
  "06/01/2026, 10:12 - Meera Iyer: Meera handles the robotics lab inventory spreadsheet",
];
const V3 = [...V2, "07/01/2026, 09:00 - Asha Rao: Asha handles the club website login renewal", "07/01/2026, 09:02 - Kiran Das: Kiran handles the annual audit binder"];
const V4 = [...V3, "08/01/2026, 09:00 - Asha Rao: One more note for the record"];

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

describe("Tier E (R3 Task 05E): deciding change-review items", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-t05e-decide");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const handbook = new Uint8Array(readFileSync(join(DIR, "handbook.md")));
  let ann = "";
  let mallory = "";
  let handoverId = "";
  const ids: Record<string, string> = {};
  const snapshots: Record<string, unknown> = {};

  const drainRun = async (runId: string) => {
    const drain = createDrainer({
      db: adminDb, storage, logger: createConsoleLogger(), getPepper: getVerifiedPepper,
      ai: { providerForRun: (rc) => getAiProviderForRun(rc), extractCandidates, verifySupport },
    });
    let status = "queued";
    for (let i = 0; i < 80 && (status === "queued" || status === "running"); i++) {
      const { result: report } = await captureConsole(() => drain({ maxJobs: 25, deadlineMs: 120_000 }));
      status = (await pg.json<string>(`select to_jsonb(status) from public.processing_runs where id = ${lit(runId)}`))!;
      if (report.claimed === 0 && (status === "queued" || status === "running")) await releaseBackedOffJobs(pg, runId);
    }
    await captureConsole(() => flushAfter());
    return status;
  };
  const snapshot = (publicationId: string) =>
    pg.json(`select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = ${lit(publicationId)}`);
  const pointCiting = (text: string) =>
    pg.json<string>(`select to_jsonb(p.id) from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id
                      where p.handover_id = ${lit(handoverId)} and r.statement like ${lit(`%${text}%`)}
                        and exists (select 1 from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                                     where pe.point_id = p.id and q.source_id = ${lit(ids.chat)})
                      order by p.created_at limit 1`);
  const revisionOf = (pointId: string) => pg.json<string>(`select to_jsonb(current_revision_id) from public.handover_points where id = ${lit(pointId)}`);
  const linksOf = (pointId: string) => pg.json<number>(`select to_jsonb(count(*)) from public.point_evidence where point_id = ${lit(pointId)}`);
  const reviews = async () => ok(await getQueries().getChangeReviews(handoverId), "change reviews");
  const find = async (kind: ChangeReviewKind, pred: (i: ChangeReviewItem) => boolean = () => true) => {
    const list = await reviews();
    const hit = list.find((i) => i.kind === kind && pred(i));
    assert.ok(hit, `${kind}: ${JSON.stringify(list.map((i) => [i.kind, i.point?.statement, i.state]))}`);
    return hit;
  };
  const about = (pointId: string) => (i: ChangeReviewItem) => i.point?.id === pointId;
  const aboutText = (text: string) => (i: ChangeReviewItem) => (i.point?.statement ?? "").includes(text);
  const decide = (item: ChangeReviewItem, input: Partial<DecideChangeReviewInput> & Pick<DecideChangeReviewInput, "decision">) =>
    decideChangeReview({
      handoverId, itemId: item.id, expectedState: item.state === "investigating" ? "investigating" : "open",
      expectedPointRevisionId: item.point!.currentRevisionId, ...input,
    });

  async function upload(name: string, kind: "whatsapp_export" | "markdown", mime: string, bytes: Uint8Array) {
    const t = ok(await createSourceUpload({ handoverId, kind, fileName: name, mimeType: mime, sizeBytes: bytes.byteLength, sha256: sha(bytes) }), `upload ${name}`);
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${t.sourceId}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: t.sourceId }), `confirm ${name}`);
    ok(await recordSourceConsent({ sourceId: t.sourceId, consentStatementVersion: STATEMENT, consentConfirmed: true, accessLevel: "everyone",
      timezone: "Asia/Kolkata", ...(kind === "whatsapp_export" ? { dateOrder: "dmy" as const } : {}) }), `consent ${name}`);
    return t.sourceId;
  }
  async function uploadVersion(previousSourceId: string, bytes: Uint8Array) {
    const r = ok(await createSourceVersionUpload({ previousSourceId, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain",
      sizeBytes: bytes.byteLength, sha256: sha(bytes) }), "version upload");
    const id = r.status === "upload" ? r.ticket.sourceId : "";
    assert.ok(id, JSON.stringify(r));
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${id}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: id }), "confirm version");
    ok(await recordSourceConsent({ sourceId: id, consentStatementVersion: STATEMENT, consentConfirmed: true, timezone: "Asia/Kolkata" }), "consent version");
    return id;
  }
  async function reviewEverything() {
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
    mallory = (await pg.json<string>(`select to_jsonb(tests.user('mallory'))`))!;
  });

  after(async () => {
    if (ENABLED) await pg.stop();
  });

  it("1. a handover with four cited responsibilities is processed and published", async () => {
    signInAs(ann, "ann@example.test");
    handoverId = ok(await createHandover({ title: "Living handover", teamName: "Synthetic Robotics Club", roleTitle: "Treasurer", creatorRole: "outgoing" }), "createHandover").id;
    ids.chat = await upload("chat.txt", "whatsapp_export", "text/plain", lines(V1));
    ids.handbook = await upload("handbook.md", "markdown", "text/markdown", handbook);
    assert.equal(await drainRun(ok(await startProcessing({ handoverId }), "process").runId), "succeeded");
    ok(await inviteMember({ handoverId, email: "inc@example.test", role: "incoming", expiresInDays: 7 }), "invite");
    await reviewEverything();
    ids.pub1 = ok(await publishHandover({ handoverId, summary: "Version 1." }), "publish 1").publicationId;
    snapshots.pub1 = await snapshot(ids.pub1);
    for (const [k, text] of [["asha", "bank signing mandate"], ["kiran", "hall booking deposits"], ["ravi", "sponsor reimbursements"], ["meera", "lab cupboard keys"]]) {
      ids[k] = (await pointCiting(text))!;
      assert.ok(ids[k], `${k} point`);
    }
  });

  it("2. version 2 is processed and its changes are detected", async () => {
    signInAs(ann, "ann@example.test");
    ok(await startRevision({ handoverId }), "start revision");
    ids.v2 = await uploadVersion(ids.chat, lines(V2));
    assert.equal(await drainRun(ok(await startProcessing({ handoverId }), "scoped").runId), "succeeded");
    const list = await reviews();
    const kinds = (k: ChangeReviewKind) => list.filter((i) => i.kind === k).length;
    assert.ok(kinds("evidence_moved") >= 2 && kinds("evidence_missing") >= 1 && kinds("possible_contradiction") >= 2 && kinds("new_information") >= 2,
      JSON.stringify(list.map((i) => [i.kind, i.point?.statement])));
    assert.ok(list.every((i) => i.state === "open"));
  });

  it("3. unauthorized users can neither read nor decide (restricted evidence stays hidden)", async () => {
    signInAs(ann, "ann@example.test");
    const item = await find("evidence_missing", about(ids.meera));
    signInAs(mallory, "mallory@example.test");
    const read = await getQueries().getChangeReviews(handoverId);
    assert.ok(!read.ok || read.data.length === 0, "an outsider reads nothing");
    const r = await decide(item, { decision: "investigate", note: "Trying to decide someone else's change." });
    assert.ok(!r.ok && (r.error.code === "not_found" || r.error.code === "forbidden"), JSON.stringify(r));
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.source_change_review_decisions`), 0, "nothing recorded");
  });

  it("4. investigating a missing quotation keeps publishing blocked (the acknowledgement does not bypass it)", async () => {
    signInAs(ann, "ann@example.test");
    const item = await find("evidence_missing", about(ids.meera));
    const r = ok(await decide(item, { decision: "investigate", note: "Asking Meera whether the keys moved." }), "investigate");
    assert.equal(r.state, "investigating");
    const refused = await publishHandover({ handoverId, acknowledgeExtractionGaps: true });
    assert.ok(!refused.ok && ["change_review_open", "source_update_pending"].includes(String(refused.error.details?.reason)), JSON.stringify(refused));
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.handover_publications where handover_id = ${lit(handoverId)}`), 1);
  });

  it("5. moved: accept links the relocated quotation; reject leaves the point untouched", async () => {
    signInAs(ann, "ann@example.test");
    const ravi = await find("evidence_moved", about(ids.ravi));
    const raviLinks = (await linksOf(ids.ravi))!;
    const accepted = ok(await decide(ravi, { decision: "accept" }), "accept moved");
    assert.equal(accepted.state, "accepted");
    const link = (await pg.json<{ src: string; check: string }>(
      `select jsonb_build_object('src', q.source_id, 'check', q.quote_check) from public.source_change_review_decisions d
         join public.point_evidence pe on pe.id = d.point_evidence_id join public.evidence_quotes q on q.id = pe.evidence_id
        where d.item_id = ${lit(ravi.id)}`))!;
    assert.deepEqual(link, { src: ids.v2, check: link.check }, "the new evidence is in the current version");
    assert.ok((await linksOf(ids.ravi))! >= raviLinks, "the historical evidence stays");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.review_actions where point_id = ${lit(ids.ravi)} and action = 'change_review'`), 1,
      "the point's history records the decision");
    ids.raviNewEvidence = (await pg.json<string>(`select to_jsonb(pe.evidence_id) from public.source_change_review_decisions d
                                                  join public.point_evidence pe on pe.id = d.point_evidence_id where d.item_id = ${lit(ravi.id)}`))!;

    const kiran = await find("evidence_moved", about(ids.kiran));
    const before = { rev: await revisionOf(ids.kiran), links: await linksOf(ids.kiran) };
    ok(await decide(kiran, { decision: "reject", note: "The re-posted line is a separate, later booking." }), "reject moved");
    assert.deepEqual({ rev: await revisionOf(ids.kiran), links: await linksOf(ids.kiran) }, before, "rejected: point and evidence unchanged");
  });

  it("6. contradiction: accept needs the reviewer's correction and a real quotation; reject keeps the point", async () => {
    signInAs(ann, "ann@example.test");
    const asha = await find("possible_contradiction", about(ids.asha));
    const body = asha.newMessage!.body;
    const missing = await decide(asha, { decision: "accept", note: "Corrected." });
    assert.ok(!missing.ok && missing.error.code === "validation_failed", "the correction is required");
    const fragment = await decide(asha, { decision: "accept", note: "Corrected.", correction: { title: "T", statement: "S", attributes: asha.point!.attributes ?? {}, evidenceStart: 0, evidenceEnd: 4 } });
    assert.ok(!fragment.ok && fragment.error.code === "validation_failed", "a fragment is not evidence");
    const start = body.indexOf("the club bank signing mandate");
    assert.ok(start >= 0, body);
    const end = body.length;
    const oldRev = (await revisionOf(ids.asha))!;
    const r = ok(await decide(asha, {
      decision: "accept", note: "The mandate moved to Kiran in April.",
      correction: { title: "Bank signing mandate", statement: "From 15 April the club bank signing mandate is with [PERSON_2].", attributes: asha.point!.attributes ?? {}, evidenceStart: start, evidenceEnd: end },
    }), "accept contradiction");
    assert.equal(r.state, "accepted");
    const now = (await pg.json<{ rev: string; state: string; statement: string; author: string }>(
      `select jsonb_build_object('rev', p.current_revision_id, 'state', p.review_state, 'statement', r.statement, 'author', r.author_kind)
         from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id where p.id = ${lit(ids.asha)}`))!;
    assert.notEqual(now.rev, oldRev, "a new revision");
    assert.equal(now.author, "profile", "written by the reviewer, not copied from an AI suggestion");
    assert.equal(now.state, "pending", "the corrected point goes back to review");
    assert.ok(await pg.json<boolean>(`select to_jsonb(exists (select 1 from public.point_revisions where id = ${lit(oldRev)}))`), "the old revision is kept");
    assert.equal(await pg.json<string>(`select to_jsonb(q.source_id) from public.source_change_review_decisions d join public.point_evidence pe on pe.id = d.point_evidence_id
                                         join public.evidence_quotes q on q.id = pe.evidence_id where d.item_id = ${lit(asha.id)}`), ids.v2,
      "supported by the new version");

    const kiran = await find("possible_contradiction", about(ids.kiran));
    const before = await revisionOf(ids.kiran);
    ok(await decide(kiran, { decision: "reject", note: "The postponement was cancelled the same day." }), "reject contradiction");
    assert.equal(await revisionOf(ids.kiran), before, "the old point stays");
  });

  it("7. new information: accept approves the candidate normally; reject rejects it without stray rows", async () => {
    signInAs(ann, "ann@example.test");
    const pointsBefore = (await pg.json<number>(`select to_jsonb(count(*)) from public.handover_points where handover_id = ${lit(handoverId)}`))!;
    const thanks = await find("new_information", aboutText("thank-you letters"));
    ok(await decide(thanks, { decision: "accept", approval: { confirmInferred: true, asKnownGap: true, resolutionNote: "Checked." } }), "accept new information");
    assert.equal(await pg.json<string>(`select to_jsonb(review_state) from public.handover_points where id = ${lit(thanks.point!.id)}`), "approved");
    const inventory = await find("new_information", aboutText("inventory spreadsheet"));
    ok(await decide(inventory, { decision: "reject", note: "Meera left the club; not part of this handover." }), "reject new information");
    assert.equal(await pg.json<string>(`select to_jsonb(review_state) from public.handover_points where id = ${lit(inventory.point!.id)}`), "rejected");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.handover_points where handover_id = ${lit(handoverId)}`), pointsBefore,
      "no duplicate or stray point");
  });

  it("8. missing: a re-attestation with a note, never replacement evidence", async () => {
    signInAs(ann, "ann@example.test");
    const item = await find("evidence_missing", about(ids.meera));
    const quotes = await pg.json<number>(`select to_jsonb(count(*)) from public.evidence_quotes where handover_id = ${lit(handoverId)}`);
    const short = await decide(item, { decision: "accept", note: "ok" });
    assert.ok(!short.ok && short.error.code === "validation_failed", "an explanation is required");
    ok(await decide(item, { decision: "accept", note: "Meera confirmed in person: the keys stay with the lab assistant." }), "re-attest");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.evidence_quotes where handover_id = ${lit(handoverId)}`), quotes, "no evidence fabricated");
    assert.equal(await pg.json<string>(`select to_jsonb(review_state) from public.handover_points where id = ${lit(ids.meera)}`), "approved");
  });

  it("9. everything resolved: the normal publication path; publication 1 never changed", async () => {
    signInAs(ann, "ann@example.test");
    // any item the detector found beyond the ones decided above is rejected with a reason, so the queue is empty
    for (const i of (await reviews()).filter((x) => x.state === "open" || x.state === "investigating")) {
      ok(await decide(i, { decision: "reject", note: "Not a change to this handover." }), `reject remaining ${i.kind}`);
    }
    await reviewEverything(); // the corrected point (pending after the correction) is approved in the ordinary review
    const readiness = ok(await getQueries().getReadiness(handoverId), "readiness");
    assert.ok(readiness.canPublish, JSON.stringify(readiness.blockers));
    ids.pub2 = ok(await publishHandover({ handoverId, summary: "Version 2." }), "publish 2").publicationId;
    assert.deepEqual(await snapshot(ids.pub1), snapshots.pub1, "publication 1 is byte-for-byte unchanged");
    const pub2 = (await pg.json<{ rev: string; evidence: string[] }>(
      `select jsonb_build_object('rev', (select revision_id from public.publication_points where publication_id = ${lit(ids.pub2)} and point_id = ${lit(ids.asha)}),
                                 'evidence', (select jsonb_agg(e ->> 'evidenceId') from public.publication_points pp, jsonb_array_elements(pp.content -> 'evidence') e
                                               where pp.publication_id = ${lit(ids.pub2)} and pp.point_id = ${lit(ids.ravi)}))`))!;
    assert.equal(pub2.rev, await revisionOf(ids.asha), "publication 2 carries the corrected revision");
    assert.ok(pub2.evidence.includes(ids.raviNewEvidence), "publication 2 carries the relocated quotation");
  });

  it("10. version 3: concurrent decisions, a changed point, and stale items after version 4", async () => {
    signInAs(ann, "ann@example.test");
    ok(await startRevision({ handoverId }), "start revision");
    ids.v3 = await uploadVersion(ids.v2, lines(V3));
    assert.equal(await drainRun(ok(await startProcessing({ handoverId }), "scoped v3").runId), "succeeded");
    const website = await find("new_information", aboutText("website login"));
    const audit = await find("new_information", aboutText("audit binder"));

    // two decisions at once on the same item: exactly one takes effect, the other is a conflict
    const [a, b] = await Promise.all([
      decide(website, { decision: "accept", approval: { confirmInferred: true, asKnownGap: true, resolutionNote: "Checked." } }),
      decide(website, { decision: "reject", note: "Not needed." }),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a, b]));
    const loser = [a, b].find((r) => !r.ok)!;
    assert.ok(!loser.ok && loser.error.code === "conflict", JSON.stringify(loser));
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.source_change_review_decisions where item_id = ${lit(website.id)}`), 1,
      "one decision, no overwrite");

    // a decision against a point revision that is no longer current is refused
    const stale = await decideChangeReview({ handoverId, itemId: audit.id, decision: "investigate", expectedState: "open",
      expectedPointRevisionId: "00000000-0000-4000-8000-000000000000", note: "Checking." });
    assert.ok(!stale.ok && stale.error.code === "conflict", JSON.stringify(stale));

    // version 4 supersedes version 3: the undecided item is stale and cannot be decided
    ids.v4 = await uploadVersion(ids.v3, lines(V4));
    const replaced = (await reviews()).find((i) => i.id === audit.id)!;
    assert.equal(replaced.state, "stale");
    const refused = await decide(audit, { decision: "reject", note: "Too late." });
    assert.ok(!refused.ok && ["precondition_failed", "invalid_transition"].includes(refused.error.code), JSON.stringify(refused));
    assert.equal((await reviews()).find((i) => i.id === website.id)!.state === "stale", false, "a decided item keeps its decision");
    assert.deepEqual(await snapshot(ids.pub1), snapshots.pub1, "publication 1 is still unchanged");
  });
});
