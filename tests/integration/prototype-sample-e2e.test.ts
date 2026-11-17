// PROTOTYPE sample data, end to end (opt-in: BATON_IT_PG=1, needs Docker; `npm test` stays Docker-free).
//
// The CodeCell sample files (lib/prototype/sample-data/codecell.ts) go through the REAL Server Functions,
// lib/db, lib/parsers, lib/privacy and the lib/pipeline drainer wired like lib/pipeline/worker.ts, against a
// throw-away Postgres with every migration. AI is the deterministic fake adapter (no paid or quota-bound
// calls, nothing hosted). Proves: the samples take the normal upload → confirm → consent → preview → process
// path; the database refuses a duplicate; a removed sample can be added again; contact details are masked;
// each section's sample point is accepted by createManualPoint without touching other points; and the
// publish safeguards still block publishing while points are pending.
//
//   BATON_IT_PG=1 node --import ./tests/integration/support/resolve.mjs --test tests/integration/prototype-sample-e2e.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { getAiProviderForRun } from "../../lib/ai/config";
import { extractCandidates } from "../../lib/ai/extract";
import { verifySupport } from "../../lib/ai/verify-support";
import { createHandover, publishHandover, startProcessing } from "../../lib/actions/handovers";
import { createManualPoint } from "../../lib/actions/review";
import { confirmSourceUploaded, createSourceUpload, previewSource, recordSourceConsent, removeSource } from "../../lib/actions/sources";
import { getQueries } from "../../lib/data";
import { SOURCE_BUCKET } from "../../lib/db/storage";
import { createConsoleLogger } from "../../lib/pipeline/log";
import { getVerifiedPepper } from "../../lib/pipeline/pepper";
import { createDrainer } from "../../lib/pipeline/runner";
import { computeIdentityPepperCanary } from "../../lib/privacy/identity";
import { CODECELL_SAMPLE_POINTS, CODECELL_SAMPLE_SOURCES, type SampleSourceFile } from "../../lib/prototype/sample-data/codecell";
import { HANDOVER_SECTIONS } from "../../components/handover/labels";
import { buildManualPointInput } from "../../components/review/manual-point";
import { sampleForm } from "../../components/review/sample-point";
import { TEST_PEPPER } from "../../fixtures/parser/load";
import { captureConsole } from "./support/console-capture";
import { PgBackedStorage, PgContainer, PsqlDbClient, lit } from "./support/pg";
import { allowFakeAi, currentUserId, flushAfter, installCustomBackends, resetPlatform, signInAs } from "./support/platform";

const ENABLED = process.env.BATON_IT_PG === "1";
// Synthetic numbers planted in the core chat (lib/demo/scenario/sources.ts): Mr. Desai, Ishaan, the opted-out member.
const PLANTED = ["99999 00008", "99999 00009", "99999 00007"];

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

const bytesOf = (s: SampleSourceFile) => new TextEncoder().encode(s.content);
const shaOf = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("Prototype sample data through the normal pipeline", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-e2e-sample");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  let user = "";
  let handoverId = "";
  const sourceIds: Record<string, string> = {};

  /** The wizard's per-file path: createSourceUpload → signed upload → confirm → consent → preview. */
  async function addSample(s: SampleSourceFile): Promise<string> {
    const bytes = bytesOf(s);
    const ticket = ok(await createSourceUpload({ handoverId, kind: s.kind, fileName: s.fileName, mimeType: s.mimeType, sizeBytes: bytes.byteLength, sha256: shaOf(bytes) }), `upload ${s.fileName}`);
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${ticket.sourceId}`, bytes);
    ok(await confirmSourceUploaded({ sourceId: ticket.sourceId }), `confirm ${s.fileName}`);
    ok(await recordSourceConsent({ sourceId: ticket.sourceId, consentStatementVersion: "consent@1", consentConfirmed: true, accessLevel: "everyone", timezone: "Asia/Kolkata" }), `consent ${s.fileName}`);
    const preview = ok(await previewSource({ sourceId: ticket.sourceId }), `preview ${s.fileName}`);
    assert.ok(preview.stats.messagesKept > 0, `${s.fileName} previews with messages`);
    return ticket.sourceId;
  }

  before(async () => {
    if (!ENABLED) return;
    await pg.start();
    resetPlatform();
    allowFakeAi();
    process.env.IDENTITY_PEPPER = TEST_PEPPER;
    process.env.IDENTITY_MAP_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"; // R3 Task 02: synthetic
    process.env.IDENTITY_MAP_KEY_VERSION = "k1";
    process.env.IDENTITY_PEPPER_VERSION = "p1";
    process.env.IDENTITY_PEPPER_CANARY = computeIdentityPepperCanary(TEST_PEPPER);
    installCustomBackends({ adminDb, userDb, adminStorage: storage, userStorage: storage });
    user = (await pg.json<string>(`select to_jsonb(tests.user('sam'))`))!;
  });

  after(async () => {
    if (ENABLED) await pg.stop();
  });

  it("1. adds every sample file through the normal upload, consent and preview path", async () => {
    signInAs(user, "sam@example.test");
    handoverId = ok(await createHandover({ title: "CodeCell technical lead", teamName: "CodeCell", roleTitle: "Technical lead", creatorRole: "outgoing" }), "createHandover").id;
    for (const s of CODECELL_SAMPLE_SOURCES) sourceIds[s.id] = await addSample(s);
  });

  it("2. adding a sample that is already there is refused by the database (no duplicate rows)", async () => {
    signInAs(user, "sam@example.test");
    const s = CODECELL_SAMPLE_SOURCES[0];
    const bytes = bytesOf(s);
    const again = await createSourceUpload({ handoverId, kind: s.kind, fileName: s.fileName, mimeType: s.mimeType, sizeBytes: bytes.byteLength, sha256: shaOf(bytes) });
    assert.ok(!again.ok);
    assert.equal(again.error.details?.reason, "duplicate_source");
    const live = await pg.json<number>(`select to_jsonb(count(*)) from public.sources where handover_id = ${lit(handoverId)} and state <> 'removed'`);
    assert.equal(live, CODECELL_SAMPLE_SOURCES.length);
  });

  it("3. a sample can be removed like any upload, and added again afterwards", async () => {
    signInAs(user, "sam@example.test");
    const s = CODECELL_SAMPLE_SOURCES[1];
    ok(await removeSource({ sourceId: sourceIds[s.id] }), "removeSource");
    assert.equal(await pg.json<string>(`select to_jsonb(state) from public.sources where id = ${lit(sourceIds[s.id])}`), "removed");
    sourceIds[s.id] = await addSample(s);
  });

  it("4. processes the samples like real sources; contact details are masked; points start pending", async (t) => {
    signInAs(user, "sam@example.test");
    const runId = ok(await startProcessing({ handoverId }), "startProcessing").runId;
    const drain = createDrainer({
      db: adminDb, storage, logger: createConsoleLogger(), getPepper: getVerifiedPepper,
      ai: { providerForRun: (rc) => getAiProviderForRun(rc), extractCandidates, verifySupport },
    });
    let status = "queued";
    for (let i = 0; i < 40 && (status === "queued" || status === "running"); i++) {
      const { result } = await captureConsole(() => drain({ maxJobs: 25, deadlineMs: 120_000 }));
      status = (await pg.json<string>(`select to_jsonb(status) from public.processing_runs where id = ${lit(runId)}`))!;
      t.diagnostic(`pass ${i}: ${JSON.stringify(result)} → ${status}`);
    }
    await captureConsole(() => flushAfter());
    assert.equal(status, "succeeded");

    const live = Object.values(sourceIds).map((id) => lit(id)).join(",");
    const states = await pg.json<string[]>(`select jsonb_agg(state) from public.sources where id in (${live})`);
    assert.deepEqual(states, CODECELL_SAMPLE_SOURCES.map(() => "parsed"));
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.sources where id in (${live}) and raw_storage_path is not null`), 0, "raw uploads deleted after parse");
    const bodies = await pg.json<string[]>(`select coalesce(jsonb_agg(body), '[]') from public.source_messages where handover_id = ${lit(handoverId)}`);
    for (const p of PLANTED) assert.ok(!JSON.stringify(bodies).includes(p), `${p} masked`);
    const points = await pg.json<Array<{ review: string; origin: string }>>(`select coalesce(jsonb_agg(jsonb_build_object('review', review_state, 'origin', origin)), '[]') from public.handover_points where handover_id = ${lit(handoverId)}`);
    assert.ok(points!.length > 0, "the fake extractor drafted points from the samples");
    assert.ok(points!.every((p) => p.review === "pending" && p.origin === "extracted"));
    assert.equal(await pg.json<string>(`select to_jsonb(state) from public.handovers where id = ${lit(handoverId)}`), "in_review");
  });

  it("5. each section's sample point is accepted by createManualPoint and leaves every other point untouched", async () => {
    signInAs(user, "sam@example.test");
    const hashBefore = await pg.json<string>(`select to_jsonb(md5(coalesce(string_agg(p.id::text || r.id::text || r.statement || p.review_state, ',' order by p.id), ''))) from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id where p.handover_id = ${lit(handoverId)}`);
    const created: string[] = [];
    for (const section of HANDOVER_SECTIONS) {
      const category = section.categories[0];
      const built = buildManualPointInput(handoverId, sampleForm(category, CODECELL_SAMPLE_POINTS[category]));
      assert.ok(built.ok, section.id);
      const point = ok(await createManualPoint(built.input), `createManualPoint ${section.id}`);
      assert.equal(point.category, category);
      assert.equal(point.reviewState, "pending", "a sample point still needs review");
      created.push(point.id);
    }
    const hashAfter = await pg.json<string>(`select to_jsonb(md5(coalesce(string_agg(p.id::text || r.id::text || r.statement || p.review_state, ',' order by p.id), ''))) from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id where p.handover_id = ${lit(handoverId)} and p.id not in (${created.map(lit).join(",")})`);
    assert.equal(hashAfter, hashBefore, "existing points and their revisions are unchanged");
  });

  it("6. publish safeguards still apply: pending points block publishing", async () => {
    signInAs(user, "sam@example.test");
    const readiness = ok(await getQueries().getReadiness(handoverId), "getReadiness");
    assert.equal(readiness.canPublish, false);
    assert.ok(readiness.blockers.some((b) => b.kind === "pending_points"));
    const published = await publishHandover({ handoverId });
    assert.ok(!published.ok, "publishing is refused while points are pending");
  });
});
