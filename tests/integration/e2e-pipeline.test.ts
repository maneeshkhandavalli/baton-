// Tier E end-to-end (opt-in: BATON_IT_PG=1, needs Docker; `npm test` stays Docker-free).
//
// The REAL Server Functions, lib/db, lib/parsers, lib/privacy, lib/pipeline (drainer + stages) and lib/ai
// (fake adapter, AI_PROVIDER=fake, BATON_ALLOW_FAKE_AI=1, NODE_ENV=test) against a throw-away local Postgres
// with every migration (support/pg.ts). Only the network edges are replaced: Supabase clients → PsqlDbClient
// (service_role / authenticated with request.jwt.claims, like PostgREST), Storage → PgBackedStorage.
//
//   1. create the handover, upload a synthetic WhatsApp export (fixtures/parser/whatsapp/pii-chat.txt plus
//      synthetic decision/owner/task lines), confirm, consent, preview;
//   2. startProcessing, then drain until the run finishes (the drainer is wired exactly like
//      lib/pipeline/worker.ts, with the provider wrapped in RecordingProvider so every AI request is scanned);
//   3. assert: pending points only, exact body-slice evidence, no raw PII anywhere persisted or sent to the AI,
//      the raw upload deleted after the parse, handover in_review;
//   4. invite and admit an incoming member, answer and accept the required gaps, approve through reviewPoint,
//      publish as the creator; the incoming member reads the publication under RLS, a non-member cannot.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { getAiProviderForRun } from "../../lib/ai/config";
import { extractCandidates } from "../../lib/ai/extract";
import type { AiProvider } from "../../lib/ai/provider";
import { verifySupport } from "../../lib/ai/verify-support";
import { createGapInterviewLink, reviewGapAnswer, submitGapAnswers } from "../../lib/actions/gaps";
import { createHandover, publishHandover, startProcessing } from "../../lib/actions/handovers";
import { inviteMember } from "../../lib/actions/members";
import { reviewPoint } from "../../lib/actions/review";
import { confirmSourceUploaded, createSourceUpload, previewSource, recordSourceConsent } from "../../lib/actions/sources";
import { getQueries } from "../../lib/data";
import { SOURCE_BUCKET } from "../../lib/db/storage";
import { createConsoleLogger } from "../../lib/pipeline/log";
import { getVerifiedPepper } from "../../lib/pipeline/pepper";
import { createDrainer } from "../../lib/pipeline/runner";
import { computeIdentityPepperCanary } from "../../lib/privacy/identity";
import { acceptInvite } from "../../lib/supabase/invites";
import { fixtureBytes, TEST_PEPPER } from "../../fixtures/parser/load";
import { captureConsole } from "./support/console-capture";
import { PgBackedStorage, PgContainer, PsqlDbClient, lit } from "./support/pg";
import { allowFakeAi, currentUserId, flushAfter, installCustomBackends, resetPlatform, signInAs } from "./support/platform";
import { recordProvider, type Recording } from "./support/recording-provider";
import { PLANTED, assertAbsent, assertNoLeaks } from "./support/sentinels";

const ENABLED = process.env.BATON_IT_PG === "1";
const FILE_NAME = `WhatsApp Chat with ${PLANTED.phone}.txt`;
const EXTRA_LINES = [
  "10/02/2024, 18:10 - Asha Rao: Ravi is responsible for the club bank account and the reimbursements every month.",
  "10/02/2024, 18:11 - Ravi Kumar: We decided to keep the sponsor list in the shared drive folder from now on.",
  "10/02/2024, 18:12 - Asha Rao: We need to renew the lab booking before the robotics fest in March.",
  `10/02/2024, 18:13 - Ravi Kumar: My personal mail is ${PLANTED.email} and backup UPI ${PLANTED.upi}`,
];

function exportBytes(): Uint8Array {
  const base = new TextDecoder().decode(fixtureBytes("whatsapp/pii-chat.txt")).replace(/\s*$/, "\n");
  return new TextEncoder().encode(`${base}${EXTRA_LINES.join("\n")}\n`);
}

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T {
  assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

describe("Tier E: upload → process → review → publish on real Postgres", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-pg-e2e");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const providers: Array<Recording<AiProvider>> = [];
  const logs: unknown[][] = [];
  const users: Record<string, string> = {};
  let handoverId = "";
  let sourceId = "";
  let runId = "";

  const as = (name: string) => signInAs(users[name], `${name}@example.test`);

  before(async () => {
    if (!ENABLED) return;
    await pg.start();
    resetPlatform();
    allowFakeAi();
    process.env.IDENTITY_PEPPER = TEST_PEPPER;
    process.env.IDENTITY_PEPPER_VERSION = "p1";
    process.env.IDENTITY_PEPPER_CANARY = computeIdentityPepperCanary(TEST_PEPPER);
    installCustomBackends({ adminDb, userDb, adminStorage: storage, userStorage: storage });
    for (const name of ["ann", "inc", "eve"]) users[name] = (await pg.json<string>(`select to_jsonb(tests.user(${lit(name)}))`))!;
  });

  after(async () => {
    if (ENABLED) await pg.stop();
  });

  it("1. creates the handover, uploads, confirms, records consent and previews", async () => {
    as("ann");
    handoverId = ok(await createHandover({ title: "Robotics treasurer handover", teamName: "Robotics Club", roleTitle: "Treasurer",
      creatorRole: "outgoing" }), "createHandover").id;
    const bytes = exportBytes();
    const ticket = ok(await createSourceUpload({ handoverId, kind: "whatsapp_export", fileName: FILE_NAME, mimeType: "text/plain",
      sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }), "createSourceUpload");
    sourceId = ticket.sourceId;
    await storage.upload(SOURCE_BUCKET, `raw/${handoverId}/${sourceId}`, bytes);
    assert.equal(ok(await confirmSourceUploaded({ sourceId }), "confirm").state, "uploaded");
    ok(await recordSourceConsent({ sourceId, consentStatementVersion: "consent@1", consentConfirmed: true, accessLevel: "everyone",
      timezone: "Asia/Kolkata", dateOrder: "dmy" }), "consent");
    const preview = ok(await previewSource({ sourceId }), "preview");
    assert.ok(preview.participants.length >= 2);
    assertNoLeaks(preview, "preview");
    const source = await pg.json<{ state: string; raw: boolean; title: string }>(
      `select jsonb_build_object('state', state, 'raw', raw_storage_path is not null, 'title', title) from public.sources where id = ${lit(sourceId)}`);
    assert.deepEqual([source.state, source.raw], ["uploaded", true], "preview changed nothing");
    assertNoLeaks(source.title, "the masked file name is the source title");
  });

  it("2. starts processing and drains until the run finishes", async () => {
    as("ann");
    runId = ok(await startProcessing({ handoverId }), "startProcessing").runId;
    const drain = createDrainer({
      db: adminDb,
      storage,
      logger: createConsoleLogger(),
      getPepper: getVerifiedPepper,
      ai: {
        providerForRun: (runConfig) => {
          const p = getAiProviderForRun(runConfig);
          if (!p.ok) return p;
          const recorded = recordProvider(p.data);
          providers.push(recorded);
          return { ok: true, data: recorded };
        },
        extractCandidates,
        verifySupport,
      },
    });
    let status = "queued";
    for (let i = 0; i < 40 && (status === "queued" || status === "running"); i++) {
      const { result: report, lines } = await captureConsole(() => drain({ maxJobs: 25, deadlineMs: 120_000 }));
      logs.push(...lines);
      status = (await pg.json<string>(`select to_jsonb(status) from public.processing_runs where id = ${lit(runId)}`))!;
      if (report.claimed === 0 && (status === "queued" || status === "running")) {
        // waiting for a backoff: make due jobs claimable now (test clock), never skip a stage
        await pg.json(`update public.processing_jobs set next_attempt_at = now() where run_id = ${lit(runId)} and status = 'queued' returning null`);
      }
    }
    const jobs = await pg.json(`select jsonb_agg(jsonb_build_object('stage', stage, 'status', status, 'err', error_message) order by created_at)
                                from public.processing_jobs where run_id = ${lit(runId)}`);
    assert.equal(status, "succeeded", `run status ${status}; jobs ${JSON.stringify(jobs)}`);
    const { lines } = await captureConsole(() => flushAfter()); // the drain startProcessing scheduled: nothing left
    logs.push(...lines);
  });

  it("3. leaves pending points with exact evidence, nothing raw persisted or sent, raw deleted, in_review", async () => {
    const state = await pg.json<string>(`select to_jsonb(state) from public.handovers where id = ${lit(handoverId)}`);
    assert.equal(state, "in_review");

    const points = await pg.json<Array<{ review: string; status: string }>>(
      `select jsonb_agg(jsonb_build_object('review', review_state, 'status', evidence_status)) from public.handover_points
        where handover_id = ${lit(handoverId)}`);
    assert.ok(points && points.length > 0, "extraction produced points");
    assert.ok(points.every((p) => p.review === "pending"), "nothing is approved by the pipeline");
    assert.ok(points.some((p) => p.status === "sourced"), "at least one point is sourced through exact quotes + supports");
    assert.equal(await pg.json(`select to_jsonb(count(*)) from public.handover_publications where handover_id = ${lit(handoverId)}`), 0);

    const evidence = await pg.json<{ verified: number; mismatched: number }>(`
      select jsonb_build_object(
        'verified', count(*) filter (where q.quote_check in ('exact', 'normalized')),
        'mismatched', count(*) filter (where q.quote_check in ('exact', 'normalized')
                                        and substr(m.body, q.quote_start + 1, q.quote_end - q.quote_start) is distinct from q.quote_text))
        from public.evidence_quotes q join public.source_messages m on m.id = q.source_message_id
       where q.handover_id = ${lit(handoverId)}`);
    assert.ok(evidence.verified > 0);
    assert.equal(evidence.mismatched, 0, "every verified quote is exactly the stored body slice");

    const persisted = await pg.json(`select jsonb_build_object(
      'messages', (select jsonb_agg(body) from public.source_messages where handover_id = ${lit(handoverId)}),
      'participants', (select jsonb_agg(display_label) from public.source_participants where handover_id = ${lit(handoverId)}),
      'conversations', (select jsonb_agg(preview) from public.source_conversations where handover_id = ${lit(handoverId)}),
      'sources', (select jsonb_agg(jsonb_build_object('t', title, 'f', original_filename)) from public.sources where handover_id = ${lit(handoverId)}),
      'revisions', (select jsonb_agg(jsonb_build_object('t', title, 's', statement, 'a', attributes)) from public.point_revisions where handover_id = ${lit(handoverId)}),
      'points', (select jsonb_agg(inference_rationale) from public.handover_points where handover_id = ${lit(handoverId)}),
      'quotes', (select jsonb_agg(quote_text) from public.evidence_quotes where handover_id = ${lit(handoverId)}),
      'links', (select jsonb_agg(verdict_rationale) from public.point_evidence where handover_id = ${lit(handoverId)}),
      'gaps', (select jsonb_agg(jsonb_build_object('q', question, 'c', context)) from public.gap_questions where handover_id = ${lit(handoverId)}),
      'jobs', (select jsonb_agg(jsonb_build_object('log', attempt_log, 'm', error_message, 'p', ai_provenance)) from public.processing_jobs where handover_id = ${lit(handoverId)}),
      'audit', (select jsonb_agg(jsonb_build_object('b', before, 'a', after)) from public.audit_logs where handover_id = ${lit(handoverId)}))`);
    assertNoLeaks(persisted, "everything persisted");

    const raw = await pg.json<{ path: string | null; deleted: boolean; audited: boolean; object: boolean }>(`select jsonb_build_object(
      'path', s.raw_storage_path, 'deleted', s.raw_deleted_at is not null,
      'audited', exists (select 1 from public.audit_logs a where a.entity_id = s.id and a.action = 'source.raw_deleted'),
      'object', exists (select 1 from storage.objects o where o.bucket_id = ${lit(SOURCE_BUCKET)} and o.name = ${lit(`raw/${handoverId}/${sourceId}`)}))
      from public.sources s where s.id = ${lit(sourceId)}`);
    assert.deepEqual(raw, { path: null, deleted: true, audited: true, object: false }, "raw upload deleted after the parse committed");
    assert.ok(!storage.has(SOURCE_BUCKET, `raw/${handoverId}/${sourceId}`));

    const hashes = (await pg.json<string[]>(`select jsonb_agg(encode(identity_hash, 'hex')) from public.source_participants
                                              where handover_id = ${lit(handoverId)}`)) ?? [];
    const sent = providers.map((p) => p.requests);
    assert.ok(sent.flat().some((r) => r.kind === "extract") && sent.flat().some((r) => r.kind === "verifySupport"), "both AI stages ran");
    assertNoLeaks(sent, "every AI request");
    assertAbsent(sent, "every AI request", [FILE_NAME, "WhatsApp Chat with", TEST_PEPPER, ...hashes]);
    assert.ok(!JSON.stringify(sent.flat().filter((r) => r.kind === "verifySupport")).includes('"stance"'), "no stance to the verifier");
    assertNoLeaks(logs, "pipeline logs");
  });

  it("4. human review and publication; the incoming member reads it under RLS, a non-member cannot", async () => {
    as("ann");
    const invite = ok(await inviteMember({ handoverId, email: "inc@example.test", role: "incoming", expiresInDays: 7 }), "invite");
    const token = decodeURIComponent(new URL(invite.url).pathname.slice("/h/".length));
    as("inc");
    const accepted = await acceptInvite(token);
    assert.ok(accepted.ok, JSON.stringify(accepted));

    as("ann");
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
        ...(p.evidenceStatus === "conflicting" ? { resolutionNote: "Checked with the outgoing treasurer." } : {}),
        ...(p.evidenceStatus === "missing" ? { asKnownGap: true } : {}),
      }), `approve ${p.evidenceStatus}`);
    }
    const readiness = ok(await queries.getReadiness(handoverId), "readiness");
    assert.ok(readiness.canPublish, JSON.stringify(readiness.blockers));
    const answered = ok(await queries.listGapQuestions(handoverId), "gaps").find((q) => q.status !== "open");
    if (answered) {
      const link = await createGapInterviewLink({ handoverId, questionIds: [answered.id], maxAccessLevel: "everyone", expiresInDays: 1 });
      assert.ok(!link.ok && link.error.code === "not_found", "a link cannot be scoped to an answered (closed) question");
    }
    const publication = ok(await publishHandover({ handoverId, summary: "Handover for the incoming treasurer." }), "publish");
    assert.equal(publication.handoverState, "approved");
    assert.equal(await pg.json(`select to_jsonb(count(*)) from public.review_actions where handover_id = ${lit(handoverId)}
                                 and action = 'approve' and actor_profile_id is null`), 0, "every approval has a human actor");

    as("inc");
    const read = ok(await queries.getPublishedHandover(handoverId), "incoming reads the publication");
    assert.ok(read.sections.length > 0);
    assertNoLeaks(read, "published handover");
    assert.deepEqual(ok(await queries.listPoints(handoverId), "incoming points"), [], "no review workspace for incoming (D3)");

    as("eve");
    const denied = await queries.getPublishedHandover(handoverId);
    assert.ok(!denied.ok && denied.error.code === "not_found", "a non-member gets not_found");
    assert.equal(await userDb.rpc("api_get_published_handover", { p_handover_id: handoverId }).then((r) => r.data), null,
      "and the RLS read itself returns nothing");
  });
});
