// Unit tests for lib/db (no database). Run:
//   node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/db/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DB_ERROR_CODES, DB_SQLSTATE_ERROR_CODES } from "../../contracts/api";
import type { VerifiedActor } from "../actor-rules";
import type { DbClient } from "../client";
import { DbError, toAppError } from "../errors";
import {
  mapAccessTokenSummary,
  mapExclusionSummary,
  mapHandoverSummary,
  mapMemberList,
  mapPointDetail,
  mapPublishedHandover,
  mapSourceMessageContext,
  mapSourceParticipant,
} from "../mappers";
import {
  addExclusion,
  checkAccountDeletion,
  confirmIdentityMatch,
  createGapInterviewLink,
  createGapQuestion,
  deleteAccountData,
  getErasureTarget,
} from "../mutations";
import { getParseExclusions } from "../pipeline";
import { clampWindow, createDbQueries } from "../queries";
import { generateRawToken, hexToBytea, isWellFormedToken, sha256Hex, tokenHashParam } from "../tokens";
import { loginPath, safeNextPath } from "../../supabase/redirects";

const H = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";

function fakeClient(responses: Record<string, { data?: unknown; error?: { code?: string; message: string } }>) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const client: DbClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const r = responses[fn] ?? { data: null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { client, calls };
}

describe("errors", () => {
  it("R8 (S1): passes every Baton SQLSTATE through as its precise DbErrorCode, with no coarsening", () => {
    for (const [state, code] of Object.entries(DB_SQLSTATE_ERROR_CODES)) {
      const e = DbError.fromRpc({ code: state, message: "secret SQL detail" });
      assert.equal(e.code, code, state);
      assert.equal(toAppError(e).code, code, `${state} reaches AppError unchanged`);
      assert.ok(!e.message.includes("secret"), "never forwards the Postgres message");
    }
    const standard: Array<[string, string]> = [
      ["23505", "conflict"], ["22P02", "validation_failed"], ["23514", "validation_failed"], ["23502", "validation_failed"],
      ["22023", "validation_failed"], ["23503", "not_found"], ["42501", "forbidden"], ["XX000", "internal"],
      ["constructor", "internal"], ["toString", "internal"],
    ];
    for (const [state, code] of standard) assert.equal(DbError.fromRpc({ code: state, message: "" }).code, code, state);
    for (const code of DB_ERROR_CODES) assert.equal(new DbError(code).code, code);
  });

  it("marks lock timeouts, serialization failures and deadlocks retryable (§5.5 item 7)", () => {
    for (const s of ["40001", "40P01", "55P03"]) assert.equal(DbError.fromRpc({ code: s, message: "" }).retryable, true);
    assert.equal(DbError.fromRpc({ code: "BTCF0", message: "" }).retryable, false);
  });

  it("toAppError hides unknown errors and attaches requestId only to internal", () => {
    const e = toAppError(new Error("boom: stack"), "req-1");
    assert.deepEqual(e, { code: "internal", message: "Something went wrong on our side.", retryable: false, details: { requestId: "req-1" } });
    assert.equal(toAppError(new DbError("conflict"), "req-1").details, undefined);
  });
});

describe("tokens (§12.4)", () => {
  it("generates 43-character base64url tokens from 32 random bytes", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
    assert.ok(isWellFormedToken(a));
    assert.ok(!isWellFormedToken("short"));
    assert.ok(!isWellFormedToken(`${a}=`));
  });

  it("hashes with SHA-256 and formats bytea as Postgres hex", async () => {
    assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(hexToBytea("00ff"), "\\x00ff");
    assert.throws(() => hexToBytea("zz"));
    assert.match(await tokenHashParam(generateRawToken()), /^\\x[0-9a-f]{64}$/);
  });
});

describe("mappers", () => {
  const handoverRow = {
    id: H, title: "Treasurer", team_name: "Robotics", role_title: null, state: "in_review", viewer_role: "reviewer",
    viewer_is_creator: true, viewer_clearance: "reviewer_only", current_publication_id: null,
    created_at: "2026-11-11T10:00:00.123456+00:00", updated_at: "2026-11-11T10:00:00+05:30",
  };

  it("maps snake_case rows to camelCase DTOs with ISO timestamps", () => {
    const dto = mapHandoverSummary(handoverRow);
    assert.equal(dto.teamName, "Robotics");
    assert.equal(dto.createdAt, "2026-11-11T10:00:00.123Z");
    assert.equal(dto.updatedAt, "2026-11-11T04:30:00.000Z");
    assert.ok(!("team_name" in dto), "no raw columns leak");
  });

  it("rejects rows with unknown enum values instead of passing them on", () => {
    assert.throws(() => mapHandoverSummary({ ...handoverRow, state: "published" }), (e: unknown) => e instanceof DbError && e.code === "internal");
  });

  it("maps a point detail, applying category attribute defaults and tombstones", () => {
    const row = {
      id: P, category: "owner", title: "Bank", statement: "Asha holds it", evidence_status: "sourced", review_state: "pending",
      access_level: "everyone", is_potentially_outdated: false, origin: "extracted", evidence_count: 1, privacy_review: "required",
      last_supported_at: null, updated_at: "2026-11-11T10:00:00Z", current_revision_id: R, revision_number: 2,
      attributes: { responsibility: "Bank" }, inference_rationale: null, privacy_review_flagged_at: "2026-11-11T10:00:00Z",
      privacy_review_reason: "participant_erasure",
      privacy_review_set: { digest: "abc", surfaces: [{ kind: "point", id: P, revision_number: null, fields: { title: "Bank" }, shared_with_point_ids: [] }] },
      inferred_confirmation: null, conflict_resolution: null, evidence: [],
      revisions: [{ id: R, number: 1, title: "[removed]", statement: "[removed]", attributes: {}, edit_reason: null, author_label: null,
                    created_at: "2026-11-11T10:00:00Z", redaction: "tombstone" }],
      review_history: [{ action: "privacy_hold", actor_label: null, note: null, created_at: "2026-11-11T10:00:00Z" }],
    };
    const dto = mapPointDetail(row);
    assert.deepEqual(dto.attributes, { responsibility: "Bank", ownerLabel: null, since: null });
    assert.deepEqual(dto.revisions[0]?.attributes, {});
    assert.equal(dto.privacyReviewDigest, "abc");
    assert.equal(dto.privacySurfaces?.[0]?.revisionNumber, undefined);
  });

  it("omits empty published sections and keeps redacted evidence as id-only", () => {
    const dto = mapPublishedHandover({
      handover_id: H, title: "T", team_name: "Team", role_title: null, publication_id: P, version: 1,
      published_at: "2026-11-11T10:00:00Z", published_by_label: "Ann", summary: null, viewer_acknowledged_at: null,
      sections: [
        { category: "risk", points: [] },
        { category: "owner", points: [{ id: R, content: {
          title: "x", statement: "y", attributes: { responsibility: "z" }, evidenceStatus: "sourced", isPotentiallyOutdated: false,
          isKnownGap: false, inferredConfirmation: null, conflictResolution: null, evidenceRedacted: true,
          evidence: [{ evidenceId: P, redacted: true }] } }] },
      ],
    });
    assert.equal(dto.sections.length, 1);
    assert.deepEqual(dto.sections[0]?.points[0]?.content.evidence, [{ evidenceId: P, redacted: true }]);
  });

  it("refuses a redacted evidence item that still carries content", () => {
    assert.throws(() => mapPublishedHandover({
      handover_id: H, title: "T", team_name: "Team", role_title: null, publication_id: P, version: 1,
      published_at: "2026-11-11T10:00:00Z", published_by_label: "Ann", summary: null, viewer_acknowledged_at: null,
      sections: [{ category: "owner", points: [{ id: R, content: {
        title: "x", statement: "y", attributes: {}, evidenceStatus: "sourced", isPotentiallyOutdated: false, isKnownGap: false,
        inferredConfirmation: null, conflictResolution: null, evidenceRedacted: true,
        evidence: [{ evidenceId: P, redacted: true, quote: "leaked" }] } }] }],
    }));
  });
});

describe("queries", () => {
  it("returns not_found for malformed ids without calling the database", async () => {
    const { client, calls } = fakeClient({});
    const q = createDbQueries({ user: () => client });
    const r = await q.getPoint("not-a-uuid");
    assert.deepEqual(r.ok, false);
    assert.equal(!r.ok && r.error.code, "not_found");
    assert.equal(calls.length, 0);
  });

  it("returns not_found when RLS hides the row (NULL result)", async () => {
    const { client, calls } = fakeClient({ api_get_handover: { data: null } });
    const r = await createDbQueries({ user: () => client }).getHandover(H);
    assert.equal(!r.ok && r.error.code, "not_found");
    assert.deepEqual(calls[0], { fn: "api_get_handover", args: { p_handover_id: H } });
  });

  it("turns forbidden and other read errors into not_found (§8.5)", async () => {
    const { client } = fakeClient({ api_list_points: { error: { code: "42501", message: "permission denied" } } });
    const r = await createDbQueries({ user: () => client }).listPoints(H);
    assert.equal(!r.ok && r.error.code, "not_found");
  });

  it("passes filters through and ignores unknown filter values", async () => {
    const { client, calls } = fakeClient({ api_list_points: { data: [] } });
    const q = createDbQueries({ user: () => client });
    assert.deepEqual(await q.listPoints(H, { category: "owner" }), { ok: true, data: [] });
    assert.equal(calls[0]?.args?.p_category, "owner");
    // @ts-expect-error invalid category at runtime
    assert.deepEqual(await q.listPoints(H, { category: "nonsense" }), { ok: true, data: [] });
    assert.equal(calls.length, 1);
  });

  it("getGapInterview hashes the token, uses the admin client and hides why a token failed", async () => {
    const user = fakeClient({});
    const admin = fakeClient({ consume_rate_limit: { data: true }, get_gap_interview: { error: { code: "BTTI0", message: "expired" } } });
    const q = createDbQueries({ user: () => user.client, admin: () => admin.client });
    const token = generateRawToken();
    const r = await q.getGapInterview(token);
    assert.equal(!r.ok && r.error.code, "token_invalid");
    assert.equal(user.calls.length, 0);
    assert.equal(admin.calls[0]?.fn, "consume_rate_limit", "M6: the rate limit is consumed before the lookup");
    const lookup = admin.calls.find((c) => c.fn === "get_gap_interview");
    assert.match(String(lookup?.args?.p_token_hash), /^\\x[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(admin.calls).includes(token), "raw token never sent");
    assert.equal(((await q.getGapInterview("bad")) as { ok: false; error: { code: string } }).error.code, "token_invalid");
  });

  it("getGapInterview reports rate_limited distinctly and never looks the token up", async () => {
    const admin = fakeClient({ consume_rate_limit: { data: false } });
    const q = createDbQueries({ user: () => fakeClient({}).client, admin: () => admin.client, clientIp: () => "198.51.100.9" });
    const r = await q.getGapInterview(generateRawToken());
    assert.equal(!r.ok && r.error.code, "rate_limited");
    assert.ok(admin.calls.length === 2 && admin.calls.every((c) => c.fn === "consume_rate_limit"));
  });
});

describe("R8 read API (S9)", () => {
  const member = (id: string, extra: Record<string, unknown> = {}) => ({
    id, display_name: "ann", role: "outgoing", clearance: null, ack_required: false, is_creator: false, is_viewer: false, ...extra,
  });
  const handoverRow = {
    id: H, title: "Treasurer", team_name: "Robotics", role_title: null, state: "in_review", viewer_role: "reviewer",
    viewer_is_creator: true, viewer_clearance: "reviewer_only", current_publication_id: null,
    created_at: "2026-11-11T10:00:00Z", updated_at: "2026-11-11T10:00:00Z",
  };

  it("maps pendingCreatorTransfer, and null when the row has none", () => {
    assert.equal(mapHandoverSummary(handoverRow).pendingCreatorTransfer, null);
    assert.equal(mapHandoverSummary({ ...handoverRow, pending_creator_transfer: null }).pendingCreatorTransfer, null);
    assert.deepEqual(
      mapHandoverSummary({ ...handoverRow, pending_creator_transfer: { to_member_id: P, offered_at: "2026-11-11T10:00:00+00:00" } })
        .pendingCreatorTransfer,
      { toMemberId: P, offeredAt: "2026-11-11T10:00:00.000Z" },
    );
  });

  it("maps isCreator / isViewer and refuses two viewer rows", () => {
    const list = mapMemberList([member(H, { is_creator: true }), member(P, { is_viewer: true })]);
    assert.deepEqual(list.map((m) => [m.isCreator, m.isViewer]), [[true, false], [false, true]]);
    assert.throws(() => mapMemberList([member(H, { is_viewer: true }), member(P, { is_viewer: true })]));
  });

  it("participants never carry an identity hash", () => {
    const row = { id: P, source_id: H, source_title: "Chat", local_id: "p_1", display_label: "Asha", identity_kind: "name",
                  message_count: 3, excluded: false };
    assert.deepEqual(mapSourceParticipant(row), { id: P, sourceId: H, sourceTitle: "Chat", localId: "p_1", displayLabel: "Asha",
                                                 identityKind: "name", messageCount: 3, excluded: false });
    assert.throws(() => mapSourceParticipant({ ...row, identity_hash: "ab".repeat(32) }), "an extra hash column is rejected");
    assert.throws(() => mapSourceParticipant({ ...row, identity_kind: "email" }));
  });

  it("exclusions: scope agrees with sourceId; no hash", () => {
    const row = { id: P, kind: "participant", scope: "handover", source_id: null, identity_kind: "name", conversation_local_id: null,
                  range_start: null, range_end: null, reason: null, requested_via: "uploader", created_at: "2026-11-11T10:00:00Z" };
    assert.equal(mapExclusionSummary(row).scope, "handover");
    assert.throws(() => mapExclusionSummary({ ...row, source_id: H }), "handover scope with a source");
    assert.throws(() => mapExclusionSummary({ ...row, participant_identity_hash: "ab" }));
  });

  it("message context: exactly one quoted message when available, none when not", () => {
    const msg = (seq: number, quoted: boolean) => ({ seq, sent_at: null, author_label: "Asha", kind: "text", body: "x", location: null, is_quoted: quoted });
    const row = { point_evidence_id: P, source_id: H, source_title: "Chat", available: true, messages: [msg(0, false), msg(1, true)],
                  has_more_before: false, has_more_after: true };
    assert.equal(mapSourceMessageContext(row).messages[1]?.isQuoted, true);
    assert.throws(() => mapSourceMessageContext({ ...row, messages: [msg(0, false)] }));
    assert.throws(() => mapSourceMessageContext({ ...row, available: false }));
    assert.deepEqual(mapSourceMessageContext({ ...row, available: false, messages: [] }).messages, []);
  });

  it("access tokens: status and level; recipient only for invitations", () => {
    const row = { id: P, purpose: "gap_interview", status: "active", grant_role: null, recipient_email: "x@example.test",
                  max_access_level: "everyone", expires_at: "2026-11-18T10:00:00Z", max_uses: 20, use_count: 0, revoked_at: null,
                  created_at: "2026-11-11T10:00:00Z" };
    const dto = mapAccessTokenSummary(row);
    assert.equal(dto.status, "active");
    assert.equal(dto.recipientEmail, null, "never an address on a Gap Interview link");
    assert.throws(() => mapAccessTokenSummary({ ...row, status: "pending" }));
    assert.throws(() => mapAccessTokenSummary({ ...row, token_hash: "ab" }), "a hash column is rejected");
  });

  it("clamps the message window to 0..10, default 3", () => {
    assert.deepEqual([clampWindow(undefined), clampWindow(-4), clampWindow(50), clampWindow(2.7), clampWindow(Number.NaN)], [3, 0, 10, 2, 3]);
  });

  it("calls the R8 read functions with the user client and normalised arguments", async () => {
    const { client, calls } = fakeClient({
      api_list_participants: { data: [] }, api_list_exclusions: { data: [] }, list_access_tokens: { data: [] },
      api_list_my_creator_transfer_offers: { data: [] }, api_get_source_message_context: { data: null },
    });
    const q = createDbQueries({ user: () => client });
    assert.deepEqual(await q.listParticipants(H), { ok: true, data: [] });
    assert.deepEqual(await q.listParticipants(H, P.toUpperCase()), { ok: true, data: [] });
    assert.equal((await q.listParticipants(H, "nope") as { ok: false }).ok, false);
    assert.deepEqual(await q.listExclusions(H), { ok: true, data: [] });
    assert.deepEqual(await q.listAccessTokens(H, { purpose: "member_invite", activeOnly: true }), { ok: true, data: [] });
    // @ts-expect-error unknown purpose at runtime
    assert.deepEqual(await q.listAccessTokens(H, { purpose: "admin" }), { ok: true, data: [] });
    assert.deepEqual(await q.listMyCreatorTransferOffers(), { ok: true, data: [] });
    const ctx = await q.getSourceMessageContext(P, { before: 99 });
    assert.equal(!ctx.ok && ctx.error.code, "not_found", "NULL (testimony, hidden) → not_found");
    assert.deepEqual(calls.map((c) => c.fn), [
      "api_list_participants", "api_list_participants", "api_list_exclusions", "list_access_tokens",
      "api_list_my_creator_transfer_offers", "api_get_source_message_context",
    ]);
    assert.deepEqual(calls[0]?.args, { p_handover_id: H, p_source_id: null });
    assert.deepEqual(calls[1]?.args, { p_handover_id: H, p_source_id: P });
    assert.deepEqual(calls[3]?.args, { p_handover_id: H, p_purpose: "member_invite", p_active_only: true });
    assert.deepEqual(calls[5]?.args, { p_point_evidence_id: P, p_before: 10, p_after: 3 });
  });
});

describe("R8 mutations", () => {
  const actor = { profileId: R, email: "a@example.test", emailConfirmed: true } as VerifiedActor;

  it("addExclusion sends the source (never a handover) and the kind-specific fields", async () => {
    const { client, calls } = fakeClient({ add_exclusion: { data: P } });
    assert.deepEqual(await addExclusion(client, actor, { kind: "participant", sourceId: H, scope: "handover", identityKind: "name",
      participantIdentityHash: "ab".repeat(32), identityPepperVersion: "p1" }), { exclusionId: P });
    await addExclusion(client, actor, { kind: "conversation", sourceId: H, conversationLocalId: "c_2",
      parseContext: { timezone: "Asia/Kolkata", dateOrder: null, parserVersion: "1.0.0" } });
    assert.ok(calls.every((c) => !("p_handover_id" in (c.args ?? {}))), "S12: the database derives the handover");
    assert.equal(calls[0]?.args?.p_identity_kind, "name");
    assert.equal(calls[0]?.args?.p_scope, "handover");
    assert.deepEqual([calls[1]?.args?.p_scope, calls[1]?.args?.p_parse_timezone, calls[1]?.args?.p_parse_date_order,
                      calls[1]?.args?.p_parser_version], ["source", "Asia/Kolkata", null, "1.0.0"]);
  });

  it("confirmIdentityMatch passes the decision for one source and exclusion", async () => {
    const { client, calls } = fakeClient({});
    await confirmIdentityMatch(client, actor, { sourceId: H, exclusionId: P, decision: "different_person" });
    assert.deepEqual(calls[0], { fn: "confirm_identity_match",
      args: { p_actor_profile_id: R, p_source_id: H, p_exclusion_id: P, p_decision: "different_person" } });
  });

  it("S10/S11: a point question has no category; Gap Interview links never send a use count", async () => {
    const { client, calls } = fakeClient({ create_gap_question: { data: P }, create_gap_interview_link: { data: P } });
    await assert.rejects(createGapQuestion(client, actor, { handoverId: H, pointId: P, category: "risk", question: "q",
      priority: "optional", accessLevel: "everyone" }), (e: unknown) => e instanceof DbError && e.code === "validation_failed");
    await createGapInterviewLink(client, actor, { handoverId: H, questionIds: [P], maxAccessLevel: "everyone", expiresInDays: 7 });
    assert.equal(calls.length, 1);
    assert.ok(!("p_max_uses" in (calls[0]?.args ?? {})), "the database fixes 20 uses");
  });

  it("getErasureTarget validates the shape: a name target always has its one source", async () => {
    const good = { handoverId: H, identityKind: "name", identityHashHex: "ab".repeat(32), pepperVersion: "p1", scopeSourceId: P };
    const ok1 = fakeClient({ erasure_target: { data: good } });
    assert.equal((await getErasureTarget(ok1.client, actor, P)).scopeSourceId, P);
    for (const bad of [{ ...good, scopeSourceId: null }, { ...good, identityKind: "phone" }, { ...good, identityHashHex: "AB" }]) {
      await assert.rejects(getErasureTarget(fakeClient({ erasure_target: { data: bad } }).client, actor, P));
    }
  });

  it("D25: the typed DELETE and unique purge ids are checked on the server before the database", async () => {
    const { client, calls } = fakeClient({ check_account_deletion: { data: { purgeHandoverIds: [H] } }, delete_account_data: { data: {} } });
    const invalid = [
      { confirm: true, purgeHandoverIds: [] },
      { confirm: "delete", purgeHandoverIds: [] },
      { confirm: "DELETE ", purgeHandoverIds: [] },
      { confirm: "DELETE", purgeHandoverIds: [H, H.toUpperCase()] },
      { confirm: "DELETE", purgeHandoverIds: ["not-a-uuid"] },
      {},
      null,
    ];
    for (const input of invalid) {
      await assert.rejects(checkAccountDeletion(client, actor, input), (e: unknown) => e instanceof DbError && e.code === "validation_failed",
        JSON.stringify(input));
    }
    await assert.rejects(deleteAccountData(client, actor, { confirm: "yes" }), (e: unknown) => e instanceof DbError && e.code === "validation_failed");
    assert.equal(calls.length, 0, "nothing reaches the database");
    assert.deepEqual(await checkAccountDeletion(client, actor, { confirm: "DELETE", purgeHandoverIds: [H] }), [H]);
    assert.deepEqual(calls[0]?.args, { p_actor_profile_id: R, p_confirmation: "DELETE", p_purge_handover_ids: [H] });
    await deleteAccountData(client, actor, { confirm: "DELETE" });
    assert.deepEqual(calls[1]?.args, { p_profile_id: R, p_confirmation: "DELETE" });
  });
});

describe("R8 rule feed (S6)", () => {
  it("returns typed ExclusionRule[] and fails closed on anything malformed", async () => {
    const rule = { kind: "participant", ruleId: P, identityKind: "name", participantIdentityHash: "ab".repeat(32),
                   identityPepperVersion: "p1", mode: "detect" };
    const conv = { kind: "conversation", ruleId: H, conversationLocalId: "c_1",
                   context: { timezone: "Asia/Kolkata", dateOrder: null, parserVersion: "1.0.0" } };
    const good = fakeClient({ parse_exclusion_rules: { data: [rule, conv] } });
    assert.deepEqual(await getParseExclusions(good.client, H), [rule, conv]);
    for (const bad of [[{ ...rule, mode: "maybe" }], [{ ...rule, identityKind: undefined }], [{ ...conv, context: undefined }],
                       [{ ...rule, participantIdentityHash: "AB" }], [{ kind: "participant", participantIdentityHash: "ab".repeat(32) }]]) {
      await assert.rejects(getParseExclusions(fakeClient({ parse_exclusion_rules: { data: bad } }).client, H),
        (e: unknown) => e instanceof DbError && e.code === "internal");
    }
  });
});

describe("redirect guard", () => {
  it("only allows same-origin relative paths", () => {
    assert.equal(safeNextPath("/handover/x/review?a=1"), "/handover/x/review?a=1");
    for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "evil", "", null, "/\u0000x"]) {
      assert.equal(safeNextPath(bad as string | null), null, String(bad));
    }
    assert.equal(loginPath("//evil.test", "x"), "/login?error=x");
    assert.equal(loginPath("/dashboard"), "/login?next=%2Fdashboard");
  });
});
