// R3 Task 06: the REAL invitation Server Functions (lib/actions/invitations.ts → actionDeps → lib/db) against the
// Recording backends. Identity only from the stubbed Auth server (signInAs). Also: the raw token never reaches the
// database or any log line, and no email is ever sent without RESEND_API_KEY + BATON_EMAIL_FROM.
//
// Tier E (real Postgres, opt-in BATON_IT_PG=1) is at the end: invite → details → accept twice → wrong account →
// reissue → delivery status, on every migration.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { acceptInvitation, getInvitation, reissueInvitation, requestInvitationSignInLink } from "../../lib/actions/invitations";
import { createHandover } from "../../lib/actions/handovers";
import { inviteMember } from "../../lib/actions/members";
import { getQueries } from "../../lib/data";
import { actionWorld, ACTOR, allCalls } from "./support/actions";
import { captureConsole } from "./support/console-capture";
import { PgContainer, PsqlDbClient, PgBackedStorage } from "./support/pg";
import { authCalls, currentUserId, installCustomBackends, resetPlatform, signInAs, signOut } from "./support/platform";

const TOKEN = randomBytes(32).toString("base64url");
const PENDING = {
  state: "pending", handover_title: "Synthetic Club", inviter_name: "Asha", role: "incoming", expires_at: "2026-11-25T10:00:00Z",
  recipient_email_masked: "i***@example.org", viewer: null, member_handover_id: null, member_role: null,
};
const noToken = (w: ReturnType<typeof actionWorld>, lines: unknown[][], token: string) => {
  assert.ok(!JSON.stringify(allCalls(w)).includes(token), "the raw token never reaches the database");
  assert.ok(!JSON.stringify(lines).includes(token), "the raw token is never logged");
};

describe("R3 Task 06: invitation Server Functions (real code, recording backends)", () => {
  it("getInvitation: signed out, limits first, hash only, never redeems, nothing logged", async () => {
    const w = actionWorld(false);
    w.adminDb.returns("consume_rate_limit", true).returns("get_member_invite_details", PENDING);
    const { result, lines } = await captureConsole(() => getInvitation({ token: TOKEN }));
    assert.ok(result.ok && result.data.state === "pending" && result.data.viewer === null, JSON.stringify(result));
    assert.deepEqual(w.adminDb.fns(), ["consume_rate_limit", "get_member_invite_details"], "no client IP here: the per-token limit still applies first");
    assert.equal(w.adminDb.calls[0].args.p_scope, "invite_view_token");
    assert.equal(w.adminDb.last("get_member_invite_details")?.args.p_viewer_profile_id, null);
    assert.deepEqual(w.adminDb.unexpected, []);
    noToken(w, lines, TOKEN);
  });

  it("acceptInvitation: verified profile only; a refusal is explained; the raw token is never logged", async () => {
    const w = actionWorld(false);
    signInAs(ACTOR, "someone.else@example.org", true);
    w.adminDb.returns("consume_rate_limit", true).fails("redeem_member_invite", "BTTI0")
      .returns("get_member_invite_details", { ...PENDING, viewer: { email_matches: false, email_confirmed: true, already_member: false } });
    const { result, lines } = await captureConsole(() => acceptInvitation({ token: TOKEN }));
    assert.equal(!result.ok && result.error.code, "token_invalid");
    assert.equal(!result.ok && result.error.details?.reason, "email_mismatch");
    assert.equal(w.adminDb.last("redeem_member_invite")?.args.p_profile_id, ACTOR);
    noToken(w, lines, TOKEN);

    signOut();
    const out = await acceptInvitation({ token: TOKEN });
    assert.equal(!out.ok && out.error.code, "unauthenticated");
  });

  it("inviteMember + reissueInvitation without an email transport: not_sent/email_not_configured, no provider call", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.BATON_EMAIL_FROM;
    const w = actionWorld();
    const tokenId = randomUUID();
    w.adminDb.returns("consume_rate_limit", true).returns("invite_member", tokenId).returns("record_invitation_delivery", randomUUID())
      .returns("member_invite_recipient", "incoming.person@example.org")
      .returns("reissue_member_invite", { token_id: randomUUID(), recipient_email: "incoming.person@example.org" });
    const { result, lines } = await captureConsole(() => inviteMember({ handoverId: w.ids.handover, email: "incoming.person@example.org", role: "incoming", expiresInDays: 7 }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(result.data.delivery, { status: "not_sent", reason: "email_not_configured" });
    const raw = decodeURIComponent(new URL(result.data.url).pathname.slice("/h/".length));
    noToken(w, lines, raw);
    const re = await captureConsole(() => reissueInvitation({ tokenId }));
    assert.ok(re.result.ok, JSON.stringify(re.result));
    assert.deepEqual(re.result.data.delivery, { status: "not_sent", reason: "email_not_configured" });
    noToken(w, re.lines, decodeURIComponent(new URL(re.result.data.url).pathname.slice("/h/".length)));
    assert.deepEqual(w.adminDb.unexpected, []);
  });

  it("requestInvitationSignInLink answers the same for any token", async () => {
    const w = actionWorld(false);
    w.adminDb.returns("consume_rate_limit", true).fails("peek_member_invite", "BTTI0");
    assert.deepEqual(await requestInvitationSignInLink({ token: TOKEN }), { ok: true, data: { sent: true } });
    assert.deepEqual(await requestInvitationSignInLink({ token: "short" }), { ok: true, data: { sent: true } });
    assert.deepEqual(authCalls().filter((c) => c.name === "signInWithOtp"), [], "no email for an invalid invitation");
    assert.ok(w.adminDb.calls.length >= 1);
  });
});

// ── Tier E: real Postgres ────────────────────────────────────────────────────────────────────────────────

const ENABLED = process.env.BATON_IT_PG === "1";

describe("Tier E (R3 Task 06): invitations end to end on real Postgres", { skip: !ENABLED && "set BATON_IT_PG=1 (needs Docker)" }, () => {
  const pg = new PgContainer(process.env.BATON_IT_CONTAINER ?? "baton-it-t06-invitations");
  const storage = new PgBackedStorage(pg);
  const adminDb = new PsqlDbClient(pg, () => ({ role: "service_role" }));
  const userDb = new PsqlDbClient(pg, () => ({ role: "authenticated", sub: currentUserId() }));
  const users: Record<string, string> = {};
  let handoverId = "";
  let token = "";
  let tokenId = "";

  const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T => {
    assert.ok(r.ok, `${label}: ${JSON.stringify(!r.ok && r.error)}`);
    return r.data;
  };
  const tokenOf = (url: string) => decodeURIComponent(new URL(url).pathname.slice("/h/".length));

  before(async () => {
    if (!ENABLED) return;
    await pg.start();
    resetPlatform();
    delete process.env.RESEND_API_KEY;
    delete process.env.BATON_EMAIL_FROM;
    installCustomBackends({ adminDb, userDb, adminStorage: storage, userStorage: storage });
    for (const u of ["ann", "inc", "bob", "unc"]) users[u] = (await pg.json<string>(`select to_jsonb(tests.user('${u}'))`))!;
    const unc = await pg.psql(`update auth.users set email_confirmed_at = null where id = '${users.unc}'`);
    assert.equal(unc.code, 0, unc.stderr);
  });
  after(async () => {
    if (ENABLED) await pg.stop();
  });

  it("1. the creator invites; no email transport → not_sent; the listing shows the outcome", async () => {
    signInAs(users.ann, "ann@example.test");
    handoverId = ok(await createHandover({ title: "Invitations end to end", teamName: "Synthetic Club", roleTitle: "Treasurer", creatorRole: "outgoing" }), "create").id;
    const created = ok(await inviteMember({ handoverId, email: "INC@example.test", role: "incoming", expiresInDays: 7 }), "invite");
    assert.deepEqual(created.delivery, { status: "not_sent", reason: "email_not_configured" });
    token = tokenOf(created.url);
    tokenId = created.tokenId;
    const list = ok(await getQueries().listAccessTokens(handoverId, { purpose: "member_invite" }), "list");
    assert.equal(list.find((t) => t.id === tokenId)?.deliveryStatus, "not_sent");
    const stored = await pg.json<number>(`select to_jsonb(count(*)) from public.access_tokens where token_hash = sha256(convert_to('${token}', 'UTF8'))`);
    assert.equal(stored, 1, "stored as its SHA-256");
  });

  it("2. details: signed out, then each viewer", async () => {
    signOut();
    const d = ok(await getInvitation({ token }), "details signed out");
    assert.ok(d.state === "pending" && d.viewer === null && d.handoverTitle === "Invitations end to end" && d.recipientEmailMasked === "i***@example.test");
    signInAs(users.bob, "bob@example.test");
    const b = ok(await getInvitation({ token }), "bob");
    assert.ok(b.state === "pending" && b.viewer?.emailMatches === false);
    signInAs(users.unc, "unc@example.test", false);
    const u = ok(await getInvitation({ token }), "unc");
    assert.ok(u.state === "pending" && u.viewer?.emailMatches === false);
  });

  it("3. a wrong account is refused with its reason", async () => {
    signInAs(users.bob, "bob@example.test");
    const r = await acceptInvitation({ token });
    assert.equal(!r.ok && r.error.details?.reason, "email_mismatch");
  });

  it("4. the invited user accepts; a second submit replays; anyone else now sees used", async () => {
    signInAs(users.inc, "inc@example.test");
    const first = ok(await acceptInvitation({ token }), "accept");
    assert.deepEqual([first.handoverId, first.role, first.replayed, first.redirectTo], [handoverId, "incoming", false, `/handover/${handoverId}/published`]);
    const second = ok(await acceptInvitation({ token }), "accept again");
    assert.equal(second.replayed, true);
    assert.equal(await pg.json<number>(`select to_jsonb(count(*)) from public.handover_members where handover_id = '${handoverId}' and profile_id = '${users.inc}'`), 1);
    const mine = ok(await getInvitation({ token }), "details as member");
    assert.deepEqual(mine, { state: "accepted", handoverId, memberHref: `/handover/${handoverId}/published` });
    signInAs(users.bob, "bob@example.test");
    const used = await getInvitation({ token });
    assert.equal(!used.ok && used.error.details?.reason, "used");
    const reuse = await acceptInvitation({ token });
    assert.equal(!reuse.ok && reuse.error.details?.reason, "used");
  });

  it("5. reissue: a used invitation cannot be; a pending one is revoked and replaced atomically", async () => {
    signInAs(users.ann, "ann@example.test");
    const refused = await reissueInvitation({ tokenId });
    assert.equal(!refused.ok && refused.error.code, "invalid_transition");
    const second = ok(await inviteMember({ handoverId, email: "bob@example.test", role: "lead", expiresInDays: 7 }), "invite bob");
    const re = ok(await reissueInvitation({ tokenId: second.tokenId }), "reissue");
    signOut();
    const old = await getInvitation({ token: tokenOf(second.url) });
    assert.equal(!old.ok && old.error.details?.reason, "revoked");
    const fresh = ok(await getInvitation({ token: tokenOf(re.url) }), "new link");
    assert.ok(fresh.state === "pending" && fresh.role === "lead");
    signInAs(users.inc, "inc@example.test");
    const notCreator = await reissueInvitation({ tokenId: re.tokenId });
    assert.equal(!notCreator.ok && notCreator.error.code, "not_found", "invitations are invisible to non-creators (§12.4)");
  });
});
