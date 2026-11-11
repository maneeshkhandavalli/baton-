// Unit tests for the server actions' core (D35 pipeline). No database, no Next.js. Run:
//   node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/actions/__tests__/*.test.ts" "lib/data/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { Result } from "../../contracts/api";
import type { HandoverSummary, PointDetail } from "../../contracts/dto";
import type { SourcePreview } from "../../contracts/parser";
import * as account from "../core/account";
import * as gaps from "../core/gaps";
import * as handovers from "../core/handovers";
import * as members from "../core/members";
import * as privacy from "../core/privacy";
import * as review from "../core/review";
import * as sources from "../core/sources";
import {
  ACTOR_ID,
  FAKE_RUN_CONFIG,
  H,
  NEW_ID,
  ORIGIN,
  OTHER_ID,
  P,
  S,
  SYNTHETIC_EMAIL,
  SYNTHETIC_PHONE,
  TEST_PEPPER,
  allStrings,
  fakeDeps,
} from "./helpers";

const handoverSummary = (state: HandoverSummary["state"] = "draft"): HandoverSummary => ({
  id: H,
  title: "Synthetic handover",
  teamName: "Synthetic team",
  roleTitle: null,
  state,
  viewerRole: "outgoing",
  viewerIsCreator: true,
  viewerClearance: "reviewer_only",
  currentPublicationId: null,
  pendingCreatorTransfer: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

const pointDetail = (category: PointDetail["category"]) => ({ id: P, category }) as unknown as PointDetail;
const okResult = <T>(data: T) => async (): Promise<Result<T>> => ({ ok: true, data });

const containsRawPii = (value: unknown) =>
  allStrings(value).some((s) => s.includes("99999") || s.includes(SYNTHETIC_EMAIL));

describe("D35 order: validate → verified actor → mutation → RLS re-read", () => {
  it("invalid input is validation_failed before the actor is looked up or the database is called", async () => {
    const f = fakeDeps();
    const r = await handovers.createHandover(f.deps, { title: "x" } as never);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.ok(!r.ok && r.error.fieldErrors && "teamName" in r.error.fieldErrors);
    assert.equal(f.actorLookups, 0);
    assert.deepEqual(f.calls, []);
  });

  it("no verified session is unauthenticated with zero database calls", async () => {
    const f = fakeDeps({ actor: null });
    const r = await handovers.createHandover(f.deps, { title: "Season", teamName: "Club", creatorRole: "outgoing" });
    assert.equal(!r.ok && r.error.code, "unauthenticated");
    assert.deepEqual(f.calls, []);
    assert.equal(f.refreshes, 0);
  });

  it("the actor always comes from the session, never from the input", async () => {
    const f = fakeDeps({ rpc: { create_handover: { data: NEW_ID } }, queries: { getHandover: okResult(handoverSummary()) } });
    const input = { title: "Season", teamName: "Club", creatorRole: "outgoing", p_actor_profile_id: OTHER_ID, createdBy: OTHER_ID };
    const r = await handovers.createHandover(f.deps, input as never);
    assert.equal(r.ok, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].client, "admin");
    assert.equal(f.calls[0].args?.p_actor_profile_id, ACTOR_ID);
    assert.ok(!allStrings(f.calls[0].args).includes(OTHER_ID));
  });

  it("re-reads the DTO through the user-scoped queries and refreshes once on success", async () => {
    const f = fakeDeps({ rpc: { create_handover: { data: NEW_ID } }, queries: { getHandover: okResult(handoverSummary()) } });
    const r = await handovers.createHandover(f.deps, { title: "Season", teamName: "Club", creatorRole: "reviewer" });
    assert.deepEqual(r, { ok: true, data: handoverSummary() });
    assert.deepEqual(f.queryCalls, [{ name: "getHandover", args: [NEW_ID] }]);
    assert.equal(f.refreshes, 1);
  });

  it("passes database error codes through unchanged with a safe message", async () => {
    const f = fakeDeps({ rpc: { start_revision: { error: { code: "BTIT0", message: "secret SQL detail" } } } });
    const r = await handovers.startRevision(f.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "invalid_transition");
    assert.ok(!r.ok && !r.error.message.includes("secret"));
    assert.equal(f.refreshes, 0);
    assert.deepEqual(f.queryCalls, []);
  });

  it("anything unexpected becomes internal without leaking its message", async () => {
    const f = fakeDeps();
    f.deps.adminDb = () => {
      throw new Error("service key missing: sk_live_secret");
    };
    const r = await handovers.deleteHandover(f.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "internal");
    assert.ok(!r.ok && !r.error.message.includes("sk_live"));
  });

  it("a failed router refresh never turns a committed write into an error", async () => {
    const f = fakeDeps();
    f.deps.revalidate = () => {
      throw new Error("outside a request");
    };
    const r = await handovers.cancelProcessing(f.deps, { handoverId: H });
    assert.deepEqual(r, { ok: true, data: null });
  });
});

describe("masking of persisted free text (§12.1, QA-H1)", () => {
  it("createHandover masks title, team name, role title and description before the database", async () => {
    const f = fakeDeps({ rpc: { create_handover: { data: NEW_ID } }, queries: { getHandover: okResult(handoverSummary()) } });
    await handovers.createHandover(f.deps, {
      title: `Call ${SYNTHETIC_PHONE}`,
      teamName: `Team ${SYNTHETIC_EMAIL}`,
      roleTitle: `Role ${SYNTHETIC_PHONE}`,
      description: `Reach ${SYNTHETIC_PHONE} or ${SYNTHETIC_EMAIL}`,
      creatorRole: "outgoing",
    });
    const args = f.calls[0].args!;
    assert.ok(!containsRawPii(args), "no raw phone or email reaches create_handover");
    assert.match(String(args.p_title), /\[PHONE_1\]/);
    assert.match(String(args.p_team_name), /\[EMAIL_1\]/);
    assert.match(String(args.p_description), /\[PHONE_1\].*\[EMAIL_1\]/, "one masker per request: stable numbering");
  });

  it("re-validates after masking (a masked value that breaks the schema is validation_failed, no write)", async () => {
    const f = fakeDeps();
    // 118 chars ending in a short email: its token is longer than the address, so the title exceeds 120.
    const title = `${"ab ".repeat(37)} a@b.io`;
    assert.equal(title.length, 118);
    const r = await handovers.createHandover(f.deps, { title, teamName: "Club", creatorRole: "outgoing" });
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.deepEqual(f.calls, []);
  });

  it("publishHandover masks the summary and builds PublicationSummary from RLS re-reads", async () => {
    const f = fakeDeps({
      rpc: { publish_handover: { data: NEW_ID } },
      queries: {
        getHandover: okResult(handoverSummary("approved")),
        getPublishedHandover: okResult({ publicationId: NEW_ID, version: 2, publishedAt: "2026-11-12T10:00:00.000Z" }),
      },
    });
    const r = await handovers.publishHandover(f.deps, { handoverId: H, summary: `  Ask ${SYNTHETIC_PHONE}  ` });
    assert.ok(!containsRawPii(f.calls[0].args));
    assert.deepEqual(r, {
      ok: true,
      data: { publicationId: NEW_ID, handoverId: H, version: 2, publishedAt: "2026-11-12T10:00:00.000Z", handoverState: "approved" },
    });
  });

  it("an empty summary is sent as null", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } } });
    await handovers.publishHandover(f.deps, { handoverId: H, summary: "   " });
    assert.equal(f.calls[0].args?.p_summary, null);
  });

  it("addExclusion masks the reason", async () => {
    const f = fakeDeps({ rpc: { add_exclusion: { data: NEW_ID } } });
    const r = await sources.addExclusion(f.deps, {
      kind: "date_range",
      sourceId: S,
      scope: "source",
      rangeStart: "2026-01-01T00:00:00Z",
      rangeEnd: "2026-01-02T00:00:00Z",
      reason: `asked by ${SYNTHETIC_PHONE}`,
    });
    assert.deepEqual(r, { ok: true, data: { exclusionId: NEW_ID } });
    assert.ok(!containsRawPii(f.calls[0].args));
  });

  it("createSourceUpload masks the file name (it becomes the source title)", async () => {
    const f = fakeDeps({ rpc: { create_source: { data: NEW_ID } } });
    const r = await sources.createSourceUpload(f.deps, {
      handoverId: H,
      kind: "whatsapp_export",
      fileName: `WhatsApp Chat with ${SYNTHETIC_PHONE}.txt`,
      mimeType: "text/plain",
      sizeBytes: 100,
      sha256: "a".repeat(64),
    });
    assert.equal(r.ok, true);
    assert.ok(!containsRawPii(f.calls[0].args));
    assert.match(String(f.calls[0].args?.p_file_name), /\.txt$/);
    assert.deepEqual(f.storageCalls, [{ op: "createSignedUploadUrl", path: `raw/${H}/${NEW_ID}` }]);
  });
});

describe("review", () => {
  it("edit takes the category from a server re-read, masks text and attributes, and re-validates", async () => {
    const f = fakeDeps({ queries: { getPoint: okResult(pointDetail("contact")) } });
    const r = await review.reviewPoint(f.deps, {
      action: "edit",
      pointId: P,
      expectedRevisionId: S,
      title: "Ground booking",
      statement: `Call ${SYNTHETIC_PHONE}`,
      attributes: {
        nameLabel: `Groundsman ${SYNTHETIC_PHONE}`,
        directContact: { channel: "email", value: SYNTHETIC_EMAIL },
      },
      editReason: "clarified",
    });
    assert.equal(r.ok, true);
    const edit = f.calls.find((c) => c.fn === "edit_point")!;
    assert.match(String(edit.args?.p_statement), /\[PHONE_1\]/);
    const attrs = edit.args?.p_attributes as Record<string, unknown>;
    assert.match(String(attrs.nameLabel), /\[PHONE_1\]/);
    assert.deepEqual(attrs.directContact, { channel: "email", value: SYNTHETIC_EMAIL }, "D5: directContact is never masked");
    assert.equal(attrs.organisation, null, "defaults applied by parsePointAttributes");
    assert.equal(f.queryCalls[0].name, "getPoint");
    assert.equal(f.queryCalls.at(-1)?.name, "getPoint");
  });

  it("edit attributes invalid for the point's category are validation_failed with no write", async () => {
    const f = fakeDeps({ queries: { getPoint: okResult(pointDetail("risk")) } });
    const r = await review.reviewPoint(f.deps, {
      action: "edit",
      pointId: P,
      expectedRevisionId: S,
      title: "t",
      statement: "s",
      attributes: { nameLabel: "not a risk attribute" },
      editReason: "r",
    });
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.deepEqual(f.calls, []);
  });

  it("edit of a point the viewer cannot see is not_found with no write", async () => {
    const f = fakeDeps();
    const r = await review.reviewPoint(f.deps, {
      action: "edit", pointId: P, expectedRevisionId: S, title: "t", statement: "s", attributes: {}, editReason: "r",
    });
    assert.equal(!r.ok && r.error.code, "not_found");
    assert.deepEqual(f.calls, []);
  });

  it("reject masks the reason and needs no category lookup", async () => {
    const f = fakeDeps({ queries: { getPoint: okResult(pointDetail("risk")) } });
    await review.reviewPoint(f.deps, { action: "reject", pointId: P, reason: `wrong, see ${SYNTHETIC_EMAIL}` });
    assert.equal(f.calls[0].fn, "reject_point");
    assert.ok(!containsRawPii(f.calls[0].args));
    assert.deepEqual(f.queryCalls.map((q) => q.name), ["getPoint"], "only the final re-read");
  });

  it("resolve_privacy_review masks the redaction and surface replacements and validates revision attributes", async () => {
    const f = fakeDeps({ queries: { getPoint: okResult(pointDetail("risk")) } });
    const r = await review.reviewPoint(f.deps, {
      action: "resolve_privacy_review",
      pointId: P,
      expectedRevisionId: S,
      surfacesDigest: "digest",
      decision: "redact",
      redacted: { title: "Risk", statement: `ask ${SYNTHETIC_PHONE}`, attributes: { mitigation: SYNTHETIC_EMAIL } },
      surfaces: [
        { kind: "review_note", id: NEW_ID, decision: "redact", replacement: { note: `see ${SYNTHETIC_PHONE}` } },
        { kind: "revision", id: OTHER_ID, decision: "redact", replacement: { title: "Risk", attributes: { likelihood: "low" } } },
      ],
    });
    assert.equal(r.ok, true);
    const call = f.calls.find((c) => c.fn === "resolve_privacy_review")!;
    assert.equal(call.args?.p_actor_profile_id, ACTOR_ID);
    assert.ok(!containsRawPii(call.args));
    const decisions = call.args?.p_decisions as { surfaces: Array<{ replacement?: { attributes?: Record<string, unknown> } }> };
    assert.equal(decisions.surfaces[1].replacement?.attributes?.impact, null, "revision attributes re-validated");
  });

  it("resolve_privacy_review with revision attributes invalid for the category is validation_failed", async () => {
    const f = fakeDeps({ queries: { getPoint: okResult(pointDetail("risk")) } });
    const r = await review.reviewPoint(f.deps, {
      action: "resolve_privacy_review",
      pointId: P,
      expectedRevisionId: S,
      surfacesDigest: "digest",
      decision: "keep",
      surfaces: [{ kind: "revision", id: OTHER_ID, decision: "redact", replacement: { attributes: { likelihood: "always" } } }],
    });
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.deepEqual(f.calls, []);
  });

  it("createManualPoint masks text but keeps a direct contact, then re-reads the new point", async () => {
    const f = fakeDeps({ rpc: { create_manual_point: { data: NEW_ID } }, queries: { getPoint: okResult(pointDetail("contact")) } });
    const r = await review.createManualPoint(f.deps, {
      handoverId: H,
      category: "contact",
      title: "Groundsman",
      statement: `Books the ground, ${SYNTHETIC_PHONE}`,
      accessOverride: "leads_only",
      testimony: { text: `I called ${SYNTHETIC_PHONE}` },
      attributes: { nameLabel: "Groundsman", directContact: { channel: "phone", value: SYNTHETIC_PHONE } },
    });
    assert.equal(r.ok, true);
    const args = f.calls[0].args!;
    assert.match(String(args.p_statement), /\[PHONE_1\]/);
    assert.match(String(args.p_testimony_text), /\[PHONE_1\]/);
    assert.deepEqual((args.p_attributes as Record<string, unknown>).directContact, { channel: "phone", value: SYNTHETIC_PHONE });
    assert.deepEqual(f.queryCalls, [{ name: "getPoint", args: [NEW_ID] }]);
  });
});

describe("links: absolute url from BATON_SITE_URL, checked before the token exists", () => {
  it("inviteMember with an unsafe or missing site URL fails closed and creates no token", async () => {
    const f = fakeDeps({
      siteOrigin: () => {
        throw new Error("BATON_SITE_URL is not configured");
      },
    });
    const r = await members.inviteMember(f.deps, { handoverId: H, email: SYNTHETIC_EMAIL, role: "incoming" });
    assert.equal(!r.ok && r.error.code, "internal");
    assert.equal(!r.ok && r.error.details?.reason, "site_url_not_configured");
    assert.deepEqual(f.calls, []);
  });

  it("inviteMember returns an absolute /h/ url; only the token hash reaches the database", async () => {
    const f = fakeDeps({ rpc: { invite_member: { data: NEW_ID } } });
    const r = await members.inviteMember(f.deps, { handoverId: H, email: SYNTHETIC_EMAIL, role: "incoming", clearance: "leads_only" });
    assert.ok(r.ok);
    const raw = decodeURIComponent(r.data.url.slice(`${ORIGIN}/h/`.length));
    assert.ok(r.data.url.startsWith(`${ORIGIN}/h/`));
    assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(r.data.tokenId, NEW_ID);
    const sent = allStrings(f.calls[0].args);
    assert.ok(!sent.some((s) => s.includes(raw)), "the raw token never reaches the database");
    assert.equal(f.calls[0].args?.p_token_hash, `\\x${createHash("sha256").update(raw).digest("hex")}`);
  });

  it("createGapInterviewLink returns an absolute /g/ url and fails closed without a site URL", async () => {
    const good = fakeDeps({ rpc: { create_gap_interview_link: { data: NEW_ID } } });
    const r = await gaps.createGapInterviewLink(good.deps, { handoverId: H, questionIds: [P] });
    assert.ok(r.ok && r.data.url.startsWith(`${ORIGIN}/g/`));
    const bad = fakeDeps({ siteOrigin: () => { throw new Error("unsafe"); } });
    const r2 = await gaps.createGapInterviewLink(bad.deps, { handoverId: H, questionIds: [P] });
    assert.equal(!r2.ok && r2.error.code, "internal");
    assert.deepEqual(bad.calls, []);
  });
});

describe("gap answers", () => {
  const TOKEN = "A".repeat(43);

  it("the token path needs no session, consumes rate limits first and masks label and answers", async () => {
    const f = fakeDeps({
      actor: null,
      rpc: { consume_rate_limit: { data: true }, submit_gap_answers_with_token: { data: 1 } },
    });
    const r = await gaps.submitGapAnswers(f.deps, {
      token: TOKEN,
      answererLabel: `Coach ${SYNTHETIC_PHONE}`,
      answers: [{ gapQuestionId: P, answerText: `Mail ${SYNTHETIC_EMAIL}` }],
    });
    assert.deepEqual(r, { ok: true, data: { submitted: 1 } });
    assert.equal(f.actorLookups, 0);
    assert.deepEqual(f.fns(), ["consume_rate_limit", "consume_rate_limit", "submit_gap_answers_with_token"]);
    assert.ok(!containsRawPii(f.calls[2].args));
    assert.ok(!allStrings(f.calls).some((s) => s.includes(TOKEN)), "the raw token never reaches the database");
  });

  it("a malformed token is token_invalid with no database call", async () => {
    const f = fakeDeps();
    const r = await gaps.submitGapAnswers(f.deps, {
      token: "!".repeat(43),
      answererLabel: "Coach",
      answers: [{ gapQuestionId: P, answerText: "Yes" }],
    });
    assert.equal(!r.ok && r.error.code, "token_invalid");
    assert.deepEqual(f.calls, []);
  });

  it("the session path requires the verified actor", async () => {
    const f = fakeDeps({ actor: null });
    const r = await gaps.submitGapAnswers(f.deps, { answers: [{ gapQuestionId: P, answerText: "Yes" }] });
    assert.equal(!r.ok && r.error.code, "unauthenticated");
    assert.deepEqual(f.calls, []);
  });

  it("the session path sends masked answers with the session actor", async () => {
    const f = fakeDeps({ rpc: { submit_gap_answers: { data: 1 } } });
    const r = await gaps.submitGapAnswers(f.deps, { answers: [{ gapQuestionId: P, answerText: `Call ${SYNTHETIC_PHONE}` }] });
    assert.deepEqual(r, { ok: true, data: { submitted: 1 } });
    assert.equal(f.calls[0].args?.p_actor_profile_id, ACTOR_ID);
    assert.ok(!containsRawPii(f.calls[0].args));
  });

  it("createGapQuestion masks question and context and returns the created question from the RLS list", async () => {
    const question = { id: NEW_ID, question: "q" };
    const f = fakeDeps({
      rpc: { create_gap_question: { data: NEW_ID } },
      queries: { listGapQuestions: okResult([{ id: OTHER_ID }, question]) },
    });
    const r = await gaps.createGapQuestion(f.deps, {
      handoverId: H,
      question: `Who is ${SYNTHETIC_PHONE}?`,
      context: SYNTHETIC_EMAIL,
      priority: "required",
    });
    assert.deepEqual(r, { ok: true, data: question });
    assert.ok(!containsRawPii(f.calls[0].args));
  });

  it("reviewGapAnswer masks the note", async () => {
    const f = fakeDeps();
    await gaps.reviewGapAnswer(f.deps, { answerId: P, decision: "reject", note: `dup of ${SYNTHETIC_PHONE}` });
    assert.ok(!containsRawPii(f.calls[0].args));
  });
});

describe("sources", () => {
  it("recordSourceConsent without a configured provider writes nothing (provider_not_configured)", async () => {
    const f = fakeDeps();
    const r = await sources.recordSourceConsent(f.deps, {
      sourceId: S, consentStatementVersion: "v1", consentConfirmed: true, timezone: "Asia/Kolkata",
    });
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.equal(!r.ok && r.error.details?.reason, "provider_not_configured");
    assert.deepEqual(f.calls, []);
  });

  it("recordSourceConsent records the server's provider, never one from the input, then re-reads the source", async () => {
    const f = fakeDeps({
      aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }),
      rpc: { api_get_source: { data: { id: S } } },
    });
    await sources.recordSourceConsent(f.deps, {
      sourceId: S, consentStatementVersion: "v1", consentConfirmed: true, timezone: "Asia/Kolkata", aiProvider: "evil",
    } as never);
    assert.equal(f.calls[0].fn, "record_source_consent");
    assert.equal(f.calls[0].args?.p_ai_provider, "fake");
    assert.equal(f.calls[0].args?.p_access_level, "everyone");
    assert.deepEqual([f.calls[1].fn, f.calls[1].client], ["api_get_source", "user"]);
  });

  it("confirmSourceUploaded measures the object, then re-reads the source under RLS", async () => {
    const bytes = new TextEncoder().encode("synthetic chat export");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const f = fakeDeps({
      storage: { download: new Blob([bytes]) },
      rpc: {
        source_upload_target: { data: { raw_storage_path: `raw/${H}/${S}`, size_bytes: bytes.byteLength, sha256: sha } },
        api_get_source: { data: { id: S } },
      },
    });
    await sources.confirmSourceUploaded(f.deps, { sourceId: S });
    assert.deepEqual(f.fns(), ["source_upload_target", "confirm_source_uploaded", "api_get_source"]);
    assert.equal(f.calls[1].args?.p_measured_sha256_hex, sha);
    assert.equal(f.calls[2].client, "user");
  });

  it("removeSource deletes the raw upload only after the soft delete, and tolerates a storage failure", async () => {
    const path = `raw/${H}/${S}`;
    const f = fakeDeps({ rpc: { remove_source: { data: path } } });
    assert.deepEqual(await sources.removeSource(f.deps, { sourceId: S }), { ok: true, data: null });
    assert.deepEqual(f.fns(), ["remove_source", "mark_source_raw_deleted"]);
    assert.deepEqual(f.storageCalls, [{ op: "remove", path: [path] }]);

    const failing = fakeDeps({ rpc: { remove_source: { data: path } }, storage: { removeError: true } });
    assert.deepEqual(await sources.removeSource(failing.deps, { sourceId: S }), { ok: true, data: null });
    assert.deepEqual(failing.fns(), ["remove_source"], "raw path stays set for the retention sweep");
  });

});

// ── B3 ───────────────────────────────────────────────────────────────────────

const RAW_BYTES = new TextEncoder().encode("synthetic chat export");
const RAW_SHA = createHash("sha256").update(RAW_BYTES).digest("hex");
const PREVIEW_TARGET = {
  handover_id: H,
  raw_storage_path: `raw/${H}/${S}`,
  size_bytes: RAW_BYTES.byteLength,
  sha256: RAW_SHA,
  kind: "whatsapp_export",
  timezone: "Asia/Kolkata",
  date_order: "dmy",
  original_filename: "chat.txt",
};
const RULES = [
  { kind: "participant", ruleId: P, identityKind: "phone", participantIdentityHash: "c".repeat(64), identityPepperVersion: "p1", mode: "apply" },
];
const PREVIEW = {
  kind: "whatsapp_export",
  parserVersion: "1.0.0",
  parseContext: { timezone: "Asia/Kolkata", dateOrder: "dmy", parserVersion: "1.0.0" },
  participants: [{ localId: "p_1", displayLabel: "Participant 1", identityKind: "phone", identityHash: "d".repeat(64), identityPepperVersion: "p1", messageCount: 2 }],
  conversations: [],
  masking: { counts: {} },
  stats: { totalLines: 3, messagesKept: 2, messagesExcluded: 1, systemMessages: 0, mediaOmitted: 0 },
  identityMatches: [],
  firstMessageAt: null,
  lastMessageAt: null,
  warnings: [],
} as unknown as SourcePreview;

const previewDeps = (overrides: Parameters<typeof fakeDeps>[0] = {}) =>
  fakeDeps({
    storage: { download: new Blob([RAW_BYTES]) },
    rpc: { source_preview_target: { data: PREVIEW_TARGET }, parse_exclusion_rules: { data: RULES } },
    previewParser: async () => ({ ok: true, data: PREVIEW }),
    ...overrides,
  });

describe("previewSource (§10.3 step 1, D14, D33)", () => {
  it("checks the actor's raw access first, then reads the rules, and parses with the same rules", async () => {
    const f = previewDeps();
    const r = await sources.previewSource(f.deps, { sourceId: S });
    assert.deepEqual(r, { ok: true, data: PREVIEW }, "the contract shape, hashes included (Q1 open)");
    assert.deepEqual(f.fns(), ["source_preview_target", "parse_exclusion_rules"]);
    assert.equal(f.calls[0].args?.p_actor_profile_id, ACTOR_ID);
    assert.deepEqual(f.parserInputs.length, 1);
    const input = f.parserInputs[0];
    assert.deepEqual(input.exclusions, RULES);
    assert.equal(input.identityPepper, TEST_PEPPER);
    assert.equal(input.kind, "whatsapp_export");
    assert.equal(input.fileName, "chat.txt");
    assert.equal(input.timezone, "Asia/Kolkata");
    assert.equal(input.dateOrder, "dmy");
    assert.deepEqual([...input.bytes], [...RAW_BYTES]);
    assert.equal(f.refreshes, 0, "a read-only preview does not refresh");
  });

  it("never changes state: no mark_source_parse_failed and no storage remove, even on an integrity mismatch", async () => {
    const ok1 = previewDeps();
    await sources.previewSource(ok1.deps, { sourceId: S });
    const tampered = previewDeps({ storage: { download: new Blob([new TextEncoder().encode("different bytes")]) } });
    const r = await sources.previewSource(tampered.deps, { sourceId: S });
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    for (const f of [ok1, tampered]) {
      assert.ok(!f.fns().includes("mark_source_parse_failed"));
      assert.ok(!f.fns().includes("mark_source_raw_deleted"));
      assert.ok(!f.storageCalls.some((c) => c.op === "remove"));
    }
    assert.deepEqual(tampered.fns(), ["source_preview_target"], "rules are not read after a failed raw load");
    assert.deepEqual(tampered.parserInputs, []);
  });

  it("a source the actor may not manage is refused before the rules are read", async () => {
    const f = previewDeps({ rpc: { source_preview_target: { error: { code: "BTFB0", message: "x" } } } });
    const r = await sources.previewSource(f.deps, { sourceId: S });
    assert.equal(!r.ok && r.error.code, "forbidden");
    assert.deepEqual(f.fns(), ["source_preview_target"]);
    assert.deepEqual(f.storageCalls, []);
  });

  it("a missing or unverified pepper fails closed with its error and never parses", async () => {
    const f = previewDeps({
      verifiedPepper: () => ({
        ok: false,
        error: { code: "processing_failed", message: "Processing failed. Please try again.", retryable: true, details: { reason: "identity_pepper_unverified" } },
      }),
    });
    const r = await sources.previewSource(f.deps, { sourceId: S });
    assert.equal(!r.ok && r.error.code, "processing_failed");
    assert.equal(!r.ok && r.error.details?.reason, "identity_pepper_unverified");
    assert.deepEqual(f.parserInputs, []);
  });

  it("maps a ParserFailure to its typed code with structural details only", async () => {
    const f = previewDeps({
      previewParser: async () => ({
        ok: false,
        error: {
          code: "precondition_failed",
          message: "parser message",
          retryable: false,
          details: { inputCode: "exclusion_context_mismatch", field: "exclusions[0]", ruleId: P, value: "+91 99999 00001" },
        } as never,
      }),
    });
    const r = await sources.previewSource(f.deps, { sourceId: S });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "precondition_failed");
    assert.deepEqual(r.error.details, { inputCode: "exclusion_context_mismatch", field: "exclusions[0]", ruleId: P });
    assert.notEqual(r.error.message, "parser message");

    const g = previewDeps({
      previewParser: async () => ({
        ok: false,
        error: { code: "parse_failed", message: "m", retryable: false, details: { parserCode: "date_format_ambiguous", line: 4 } },
      }),
    });
    const r2 = await sources.previewSource(g.deps, { sourceId: S });
    assert.ok(!r2.ok);
    assert.deepEqual([r2.error.code, r2.error.details], ["parse_failed", { parserCode: "date_format_ambiguous", line: 4 }]);
  });

  it("validation and the session come first", async () => {
    const bad = previewDeps();
    assert.equal((await sources.previewSource(bad.deps, { sourceId: "x" }) as { error: { code: string } }).error.code, "validation_failed");
    const anon = previewDeps({ actor: null });
    assert.equal((await sources.previewSource(anon.deps, { sourceId: S }) as { error: { code: string } }).error.code, "unauthenticated");
    assert.deepEqual([...bad.calls, ...anon.calls], []);
  });
});

describe("startProcessing (I3)", () => {
  const SOURCES = [
    { id: S, state: "uploaded", rawDeletedAt: null },
    { id: P, state: "parsed", rawDeletedAt: "2026-11-10T00:00:00.000Z" },
  ];
  const JOBS = [
    { stage: "parse", sourceId: S, inputHashHex: "1".repeat(64) },
    { stage: "extract", sourceId: S, inputHashHex: "2".repeat(64) },
    { stage: "verify_support", sourceId: null, inputHashHex: "3".repeat(64) },
  ] as const;

  const startDeps = (overrides: Parameters<typeof fakeDeps>[0] = {}) =>
    fakeDeps({
      queries: { listSources: okResult(SOURCES) },
      aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }),
      planProcessingRun: (input) => ({ ok: true, data: { pipelineVersion: "pipeline@1", aiConfig: input.aiConfig, jobs: [...JOBS] } }),
      rpc: { start_processing: { data: NEW_ID } },
      ...overrides,
    });

  it("without a configured provider: precondition_failed, provider_not_configured, zero RPCs, no drain", async () => {
    const f = fakeDeps({ queries: { listSources: okResult(SOURCES) } });
    const r = await handovers.startProcessing(f.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.equal(!r.ok && r.error.details?.reason, "provider_not_configured");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.planInputs, []);
  });

  it("plans from the RLS source list and the server run config, and passes the jobs through unchanged", async () => {
    const f = startDeps();
    const r = await handovers.startProcessing(f.deps, { handoverId: H });
    assert.deepEqual(r, { ok: true, data: { runId: NEW_ID } });
    assert.deepEqual(f.queryCalls, [{ name: "listSources", args: [H] }]);
    assert.deepEqual(f.planInputs, [
      {
        handoverId: H,
        sources: [
          { id: S, state: "uploaded", rawAvailable: true },
          { id: P, state: "parsed", rawAvailable: false },
        ],
        aiConfig: FAKE_RUN_CONFIG,
      },
    ]);
    const start = f.calls.find((c) => c.fn === "start_processing")!;
    assert.equal(start.client, "admin");
    assert.equal(start.args?.p_actor_profile_id, ACTOR_ID);
    assert.equal(start.args?.p_handover_id, H);
    assert.equal(start.args?.p_pipeline_version, "pipeline@1");
    assert.deepEqual(start.args?.p_ai_config, FAKE_RUN_CONFIG);
    assert.deepEqual(
      start.args?.p_jobs,
      JOBS.map((j) => ({ stage: j.stage, sourceId: j.sourceId, inputHash: j.inputHashHex })),
      "the planned jobs, unchanged",
    );
  });

  it("scheduleDrain runs only after a successful start", async () => {
    const f = startDeps();
    await handovers.startProcessing(f.deps, { handoverId: H });
    assert.deepEqual(f.events, ["start_processing", "scheduleDrain"]);

    const refused = startDeps({ rpc: { start_processing: { error: { code: "BTPF0", message: "x" } } } });
    const r = await handovers.startProcessing(refused.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.deepEqual(refused.events, ["start_processing"], "no drain when the run was not created");

    const badPlan = startDeps({
      planProcessingRun: () => ({ ok: false, error: { code: "validation_failed", message: "m", retryable: false } }),
    });
    const r2 = await handovers.startProcessing(badPlan.deps, { handoverId: H });
    assert.equal(!r2.ok && r2.error.code, "validation_failed");
    assert.deepEqual(badPlan.events, []);
  });

  it("a throwing scheduleDrain never fails a started run", async () => {
    const f = startDeps({ scheduleDrainThrows: true });
    assert.deepEqual(await handovers.startProcessing(f.deps, { handoverId: H }), { ok: true, data: { runId: NEW_ID } });
  });

  it("a handover the viewer cannot see is not_found before the AI config or any write", async () => {
    const f = startDeps({ queries: {} });
    const r = await handovers.startProcessing(f.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "not_found");
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.planInputs, []);
  });

  it("validation and the session come first", async () => {
    const anon = startDeps({ actor: null });
    assert.equal((await handovers.startProcessing(anon.deps, { handoverId: H }) as { error: { code: string } }).error.code, "unauthenticated");
    assert.deepEqual(anon.queryCalls, []);
  });
});

describe("D27: erasure and account deletion stay fail-closed", () => {
  it("eraseParticipant validates, requires the actor, then refuses before any database call", async () => {
    const f = fakeDeps();
    const r = await privacy.eraseParticipant(f.deps, { handoverId: H, participantId: P, confirm: true });
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.equal(!r.ok && r.error.details?.reason, "recovery_manifest_unavailable");
    assert.equal(f.actorLookups, 1);
    assert.deepEqual(f.calls, [], "neither erasure_target nor erase_participant is called");

    assert.equal((await privacy.eraseParticipant(f.deps, { handoverId: H, participantId: P, confirm: false } as never) as { error: { code: string } }).error.code, "validation_failed");
    const anon = fakeDeps({ actor: null });
    assert.equal((await privacy.eraseParticipant(anon.deps, { handoverId: H, participantId: P, confirm: true }) as { error: { code: string } }).error.code, "unauthenticated");
  });

  it("deleteAccount checks the typed word on the server, then refuses before any write", async () => {
    const f = fakeDeps();
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H] });
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.equal(!r.ok && r.error.details?.reason, "recovery_manifest_unavailable");
    assert.deepEqual(f.calls, []);
    assert.equal(f.refreshes, 0);

    for (const confirm of ["delete", "DELETE ", true]) {
      const g = fakeDeps();
      const bad = await account.deleteAccount(g.deps, { confirm, purgeHandoverIds: [] } as never);
      assert.equal(!bad.ok && bad.error.code, "validation_failed", String(confirm));
      assert.equal(g.actorLookups, 0);
    }
    const dup = await account.deleteAccount(fakeDeps().deps, { confirm: "DELETE", purgeHandoverIds: [H, H.toUpperCase()] });
    assert.equal(!dup.ok && dup.error.code, "validation_failed");
  });

  it("getAccountDeletionBlockers reads the caller's own handovers with the user client", async () => {
    const f = fakeDeps({ rpc: { get_account_deletion_blockers: { data: [{ id: H, title: "Synthetic", deleted: false }] } } });
    const r = await account.getAccountDeletionBlockers(f.deps);
    assert.deepEqual(r, { ok: true, data: { createdHandovers: [{ id: H, title: "Synthetic", deleted: false }] } });
    assert.equal(f.calls[0].client, "user");
    assert.equal(f.refreshes, 0);
    const anon = fakeDeps({ actor: null });
    assert.equal((await account.getAccountDeletionBlockers(anon.deps) as { error: { code: string } }).error.code, "unauthenticated");
    assert.deepEqual(anon.calls, []);
  });
});

describe("pass-through mutations use the verified actor and the parsed ids only", () => {
  const cases: Array<[string, () => Promise<Result<unknown>>, string, Record<string, unknown>, ReturnType<typeof fakeDeps>]> = [];
  const add = (name: string, fn: string, args: Record<string, unknown>, run: (d: ReturnType<typeof fakeDeps>) => Promise<Result<unknown>>) => {
    const f = fakeDeps();
    cases.push([name, () => run(f), fn, args, f]);
  };
  add("cancelProcessing", "cancel_processing", { p_handover_id: H }, (f) => handovers.cancelProcessing(f.deps, { handoverId: H }));
  add("deleteHandover", "delete_handover", { p_handover_id: H }, (f) => handovers.deleteHandover(f.deps, { handoverId: H }));
  add("offerCreatorTransfer", "offer_creator_transfer", { p_handover_id: H, p_to_member_id: P }, (f) =>
    handovers.offerCreatorTransfer(f.deps, { handoverId: H, toMemberId: P }));
  add("respondToCreatorTransfer", "respond_to_creator_transfer", { p_handover_id: H, p_accept: true }, (f) =>
    handovers.respondToCreatorTransfer(f.deps, { handoverId: H, accept: true }));
  add("confirmIdentityMatch", "confirm_identity_match", { p_source_id: S, p_exclusion_id: P, p_decision: "same_person" }, (f) =>
    sources.confirmIdentityMatch(f.deps, { sourceId: S, exclusionId: P, decision: "same_person" }));
  add("revokeAccessToken", "revoke_access_token", { p_token_id: P }, (f) => gaps.revokeAccessToken(f.deps, { tokenId: P }));
  add("updateMemberClearance", "update_member_clearance", { p_member_id: P, p_clearance: "leads_only" }, (f) =>
    members.updateMemberClearance(f.deps, { memberId: P, clearance: "leads_only" }));
  add("removeMember", "remove_member", { p_member_id: P }, (f) => members.removeMember(f.deps, { memberId: P }));
  add("acknowledgePublication", "acknowledge_publication", { p_publication_id: P, p_statement_version: "ack-v1" }, (f) =>
    members.acknowledgePublication(f.deps, { publicationId: P, statementVersion: "ack-v1" }));

  for (const [name, run, fn, args, f] of cases) {
    it(name, async () => {
      assert.deepEqual(await run(), { ok: true, data: null });
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].fn, fn);
      assert.equal(f.calls[0].client, "admin");
      assert.deepEqual(f.calls[0].args, { p_actor_profile_id: ACTOR_ID, ...args });
      assert.equal(f.refreshes, 1);
    });
  }

  it("a malformed id is validation_failed with no database call", async () => {
    const f = fakeDeps();
    const r = await members.removeMember(f.deps, { memberId: "not-a-uuid" });
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.deepEqual(f.calls, []);
  });
});
