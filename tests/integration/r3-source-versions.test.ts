// Round 3 Task 05B Tier E (opt-in: BATON_IT_PG=1, needs Docker; `npm test` stays Docker-free).
//
// A new VERSION of a source through the real Server Functions, lib/db, lib/parsers, the lib/pipeline drainer and
// the lib/ai fake adapter, on real Postgres:
//   1. version 1 of a WhatsApp export is uploaded with a source-scoped participant exclusion and processed;
//   2. version 2 (the same chat with later messages) is uploaded as a new version of it: pending until consent,
//      then current; version 1 is superseded, never removed;
//   3. retries are safe: the same file against the old version is stale, against the current one unchanged;
//   4. the next run processes version 2 only; version 1's evidence stays attached and active; the excluded
//      participant is dropped from version 2 too (the exclusion was carried over).
//
//   BATON_IT_PG=1 BATON_IT_CONTAINER=baton-it-t05 node --import ./tests/integration/support/resolve.mjs \
//     --test tests/integration/r3-source-versions.test.ts
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
import { addExclusion, confirmSourceUploaded, createSourceUpload, createSourceVersionUpload, recordSourceConsent } from "../../lib/actions/sources";
import { SOURCE_BUCKET } from "../../lib/db/storage";
import { createConsoleLogger } from "../../lib/pipeline/log";
import { getVerifiedPepper } from "../../lib/pipeline/pepper";
import { createDrainer } from "../../lib/pipeline/runner";
import { computeIdentityHash, computeIdentityPepperCanary, identityKindOf } from "../../lib/privacy/identity";
import { TEST_PEPPER } from "../../fixtures/parser/load";
import { captureConsole } from "./support/console-capture";
import { PgBackedStorage, PgContainer, PsqlDbClient, lit } from "./support/pg";
import { allowFakeAi, currentUserId, flushAfter, installCustomBackends, resetPlatform, signInAs } from "./support/platform";

const ENABLED = process.env.BATON_IT_PG === "1";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "round3-conflict");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

describe("Tier E (R3 Task 05B): a new version of a source", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-t05-versions");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const v1Bytes = new Uint8Array(readFileSync(join(DIR, "chat.txt")));
  const v2Bytes = new TextEncoder().encode(
    new TextDecoder().decode(v1Bytes).replace(/\s*$/, "\n") +
      "06/01/2026, 10:00 - Ravi Kumar: The sponsor reimbursements moved to the new drive folder\n" +
      "06/01/2026, 10:05 - Asha Rao: The bank signing mandate submission was moved to 15 April\n",
  );
  const excludedHash = computeIdentityHash("Ravi Kumar", TEST_PEPPER);
  let ann = "";
  let handoverId = "";
  let v1 = "";
  let v2 = "";

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
        await pg.json(`select to_jsonb(count(*)) from (update public.processing_jobs set next_attempt_at = now() - interval '1 second'
                        where run_id = ${lit(runId)} and status = 'queued' and next_attempt_at > now() returning 1) x`);
      }
    }
    await captureConsole(() => flushAfter());
    return status;
  };
  const activeEvidenceOf = (sourceId: string) =>
    pg.json<number>(`select to_jsonb(count(*)) from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                      where q.source_id = ${lit(sourceId)} and pe.excluded_at is null`);

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

  it("1. version 1, with a source-scoped participant exclusion, is uploaded and processed", async () => {
    signInAs(ann, "ann@example.test");
    handoverId = ok(await createHandover({ title: "Versioned handover", teamName: "Synthetic Robotics Club", roleTitle: "Treasurer", creatorRole: "outgoing" }), "createHandover").id;
    const t = ok(await createSourceUpload({ handoverId, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain", sizeBytes: v1Bytes.byteLength, sha256: sha(v1Bytes) }), "upload v1");
    v1 = t.sourceId;
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${v1}`, v1Bytes);
    ok(await confirmSourceUploaded({ sourceId: v1 }), "confirm v1");
    ok(await recordSourceConsent({ sourceId: v1, consentStatementVersion: "consent@1", consentConfirmed: true, accessLevel: "everyone", timezone: "Asia/Kolkata", dateOrder: "dmy" }), "consent v1");
    ok(await addExclusion({ kind: "participant", sourceId: v1, scope: "source", identityKind: identityKindOf("Ravi Kumar"), participantIdentityHash: excludedHash, identityPepperVersion: "p1" }), "exclude Ravi in v1");
    const runId = ok(await startProcessing({ handoverId }), "process v1").runId;
    assert.equal(await drainRun(runId), "succeeded");
    assert.equal(await pg.json<string>(`select to_jsonb(state) from public.handovers where id = ${lit(handoverId)}`), "in_review");
    assert.ok((await activeEvidenceOf(v1))! > 0, "version 1 produced evidence");
  });

  it("2. version 2 is pending until its consent, then current; version 1 is superseded, not removed", async () => {
    signInAs(ann, "ann@example.test");
    const evidenceBefore = await activeEvidenceOf(v1);
    const r = ok(await createSourceVersionUpload({ previousSourceId: v1, kind: "whatsapp_export", fileName: "chat (2).txt", mimeType: "text/plain", sizeBytes: v2Bytes.byteLength, sha256: sha(v2Bytes) }), "version upload");
    assert.equal(r.status, "upload");
    v2 = r.status === "upload" ? r.ticket.sourceId : "";
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${v2}`, v2Bytes);
    ok(await confirmSourceUploaded({ sourceId: v2 }), "confirm v2");
    const before = await pg.json<{ cur: string; pend: number | null }>(
      `select jsonb_build_object('cur', (select id from public.sources where lineage_id = ${lit(v1)} and version_number is not null and superseded_at is null),
                                 'pend', (select version_number from public.sources where id = ${lit(v2)}))`);
    assert.deepEqual(before, { cur: v1, pend: null }, "before consent version 1 is still current");

    // fresh consent activates it; the access level defaults to version 1's
    const s = ok(await recordSourceConsent({ sourceId: v2, consentStatementVersion: "consent@1", consentConfirmed: true, timezone: "Asia/Kolkata", dateOrder: "dmy" }), "consent v2");
    assert.equal(s.accessLevel, "everyone");
    assert.deepEqual(s.version, { lineageId: v1, versionNumber: 2, supersedesSourceId: v1, supersededAt: null, supersededBySourceId: null,
      updateState: "awaiting_processing", updateError: null, openReviews: 0 }); // R3 Task 05C/05D: the update's state and open reviews
    const old = await pg.json<{ state: string; deleted: boolean; by: string }>(
      `select jsonb_build_object('state', state, 'deleted', deleted_at is not null, 'by', superseded_by_source_id) from public.sources where id = ${lit(v1)}`);
    assert.deepEqual(old, { state: "parsed", deleted: false, by: v2 });
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.source_version_changes where to_source_id = ${lit(v2)} and state = 'awaiting_processing'`), 1);
    assert.equal(await activeEvidenceOf(v1), evidenceBefore, "version 1's evidence is untouched");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.source_exclusions where source_id = ${lit(v2)} and kind = 'participant'`), 1,
      "the participant exclusion is carried to version 2");
  });

  it("3. retries are safe: no second version, useful refusals", async () => {
    signInAs(ann, "ann@example.test");
    const stale = await createSourceVersionUpload({ previousSourceId: v1, kind: "whatsapp_export", fileName: "chat (2).txt", mimeType: "text/plain", sizeBytes: v2Bytes.byteLength, sha256: sha(v2Bytes) });
    assert.equal(stale.ok, false);
    assert.equal(!stale.ok && stale.error.details?.reason, "stale");
    assert.equal(!stale.ok && stale.error.details?.sourceId, v2, "names the current version");
    const same = ok(await createSourceVersionUpload({ previousSourceId: v2, kind: "whatsapp_export", fileName: "chat (2).txt", mimeType: "text/plain", sizeBytes: v2Bytes.byteLength, sha256: sha(v2Bytes) }), "same file");
    assert.deepEqual(same, { status: "unchanged", sourceId: v2 });
    const kind = await createSourceVersionUpload({ previousSourceId: v2, kind: "markdown", fileName: "notes.md", mimeType: "text/markdown", sizeBytes: 10, sha256: "b".repeat(64) });
    assert.equal(!kind.ok && kind.error.details?.reason, "source_version_kind_changed");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.sources where lineage_id = ${lit(v1)}`), 2, "still exactly two versions");
  });

  it("4. the next run processes version 2 only; version 1's evidence stays; the exclusion holds in version 2", async () => {
    signInAs(ann, "ann@example.test");
    const evidenceBefore = await activeEvidenceOf(v1);
    const runId = ok(await startProcessing({ handoverId }), "process v2").runId;
    assert.deepEqual(await pg.json<string[]>(`select to_jsonb(source_ids) from public.processing_runs where id = ${lit(runId)}`), [v2]);
    assert.equal(await drainRun(runId), "succeeded");
    assert.equal(await pg.json<string>(`select to_jsonb(state) from public.sources where id = ${lit(v2)}`), "parsed");
    assert.equal(await activeEvidenceOf(v1), evidenceBefore, "version 1's evidence is still attached and active");
    const excluded = await pg.json<number>(
      `select to_jsonb(count(*)) from public.source_messages m join public.source_participants p on p.id = m.participant_id
        where m.source_id = ${lit(v2)} and p.identity_hash = decode(${lit(excludedHash)}, 'hex')`);
    assert.equal(excluded, 0, "no message of the excluded participant was stored for version 2");
    // version 2 has 7 messages, 3 of them by the excluded participant: exactly the other 4 are stored (7 without the exclusion)
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.source_messages where source_id = ${lit(v2)}`), 4,
      "the carried exclusion dropped every message of the participant from version 2");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.source_messages where source_id = ${lit(v2)} and body ilike '%new drive folder%'`), 0,
      "their new message is not stored");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.source_messages where source_id = ${lit(v2)} and body ilike '%15 April%'`), 1,
      "the other participant's new message is");
    assert.ok((await pg.json<number>(`select to_jsonb(count(*)) from public.source_messages where source_id = ${lit(v2)}`))! > 0, "version 2 was parsed");
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.processing_jobs where run_id = ${lit(runId)} and source_id = ${lit(v1)}`), 0,
      "no job ever touched version 1");
  });
});
