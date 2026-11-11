import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { IDENTITY_HASH_PATTERN } from "../../contracts/identity";
import type { CreateGapLinkInput } from "../../contracts/schemas";
import { createGapInterviewLink, inviteMember, publishHandover, revokeAccessToken } from "../actions";
import { CODECELL_ID } from "../fixtures/codecell";
import { PROFILES } from "../fixtures/profiles";
import { NS, seedId } from "../ids";
import { createMockQueries } from "../queries";
import { getStore } from "../store";
import { expectError, expectOk, resetStore, signInAs } from "./helpers";

const as = (profileId: string) => createMockQueries(profileId);

describe("listMembers flags (U2)", () => {
  beforeEach(() => resetStore());

  it("marks exactly one row as the viewer, and the creator's row", async () => {
    for (const p of [PROFILES.priya, PROFILES.arjun, PROFILES.kabir, PROFILES.neha]) {
      const members = expectOk(await as(p.id).listMembers(CODECELL_ID));
      const mine = members.filter((m) => m.isViewer);
      assert.equal(mine.length, 1, p.displayName);
      assert.equal(mine[0].displayName, p.displayName);
      assert.deepEqual(members.filter((m) => m.isCreator).map((m) => m.displayName), [PROFILES.priya.displayName]);
    }
  });

  it("shows clearance only to the creator", async () => {
    assert.ok(expectOk(await as(PROFILES.priya.id).listMembers(CODECELL_ID)).every((m) => m.clearance !== null));
    assert.ok(expectOk(await as(PROFILES.arjun.id).listMembers(CODECELL_ID)).every((m) => m.clearance === null));
  });
});

describe("listAccessTokens (§12.4, U2)", () => {
  beforeEach(() => resetStore());

  it("gives the creator invitations with recipients, and pending ones with activeOnly", async () => {
    const all = expectOk(await as(PROFILES.priya.id).listAccessTokens(CODECELL_ID));
    assert.ok(all.some((t) => t.purpose === "member_invite" && t.recipientEmail));
    const pending = expectOk(await as(PROFILES.priya.id).listAccessTokens(CODECELL_ID, { purpose: "member_invite", activeOnly: true }));
    assert.deepEqual(pending.map((t) => t.recipientEmail), ["faculty.advisor@example.edu"]);
    // Precedence is revoked → expired → exhausted: used invitations past their expiry list as expired.
    assert.deepEqual(
      all.filter((t) => t.purpose === "member_invite").map((t) => t.status).sort(),
      ["active", "expired", "expired"],
    );
    assert.ok(all.filter((t) => t.purpose === "member_invite" && t.status === "expired").every((t) => t.useCount === t.maxUses));
  });

  it("gives other review roles Gap Interview links only, and never a raw token", async () => {
    const list = expectOk(await as(PROFILES.arjun.id).listAccessTokens(CODECELL_ID));
    assert.ok(list.length > 0);
    assert.ok(list.every((t) => t.purpose === "gap_interview" && t.recipientEmail === null));
    for (const t of list) assert.ok(!("token" in t));
  });

  it("gives non-review members nothing", async () => {
    assert.deepEqual(expectOk(await as(PROFILES.neha.id).listAccessTokens(CODECELL_ID)), []);
    assert.deepEqual(expectOk(await as(PROFILES.kabir.id).listAccessTokens(CODECELL_ID)), []);
  });

  it("derives revoked before expired before exhausted", async () => {
    const list = expectOk(await as(PROFILES.priya.id).listAccessTokens(CODECELL_ID, { purpose: "gap_interview" }));
    assert.deepEqual(list.map((t) => t.status).sort(), ["active", "revoked"]);
  });

  it("lists a new invitation as a pending one that still counts as an incoming recipient", async () => {
    const link = expectOk(await inviteMember({ handoverId: CODECELL_ID, email: "new.person@example.edu", role: "incoming" }));
    assert.ok(link.tokenId && link.url.includes("/h/") && link.expiresAt);
    const pending = expectOk(await as(PROFILES.priya.id).listAccessTokens(CODECELL_ID, { purpose: "member_invite", activeOnly: true }));
    assert.ok(pending.some((t) => t.id === link.tokenId && t.grantRole === "incoming" && t.maxUses === 1 && t.useCount === 0));
    expectError(await inviteMember({ handoverId: CODECELL_ID, email: "new.person@example.edu", role: "incoming" }), "conflict");
  });
});

describe("revokeAccessToken (§12.4)", () => {
  beforeEach(() => resetStore());

  it("lets a non-creator review role turn off Gap Interview links but not invitations", async () => {
    signInAs(PROFILES.arjun.id);
    expectError(await revokeAccessToken({ tokenId: seedId(NS.token, 4) }), "not_found");
    expectOk(await revokeAccessToken({ tokenId: seedId(NS.token, 1) }));
    const t = expectOk(await as(PROFILES.arjun.id).listAccessTokens(CODECELL_ID)).find((x) => x.id === seedId(NS.token, 1));
    assert.equal(t?.status, "revoked");
    expectError(await revokeAccessToken({ tokenId: seedId(NS.token, 1) }), "invalid_transition");
  });

  it("lets the creator turn off an invitation", async () => {
    expectOk(await revokeAccessToken({ tokenId: seedId(NS.token, 4) }));
    assert.deepEqual(expectOk(await as(PROFILES.priya.id).listAccessTokens(CODECELL_ID, { purpose: "member_invite", activeOnly: true })), []);
  });

  it("a revoked Gap Interview link stops working", async () => {
    const token = getStore().tokens.find((t) => t.id === seedId(NS.token, 1))!.token;
    expectOk(await as(PROFILES.priya.id).getGapInterview(token));
    expectOk(await revokeAccessToken({ tokenId: seedId(NS.token, 1) }));
    expectError(await as(PROFILES.priya.id).getGapInterview(token), "token_invalid");
  });
});

describe("createGapInterviewLink (U1)", () => {
  beforeEach(() => resetStore());

  it("returns a CreatedLink with 20 uses at the requested level", async () => {
    const q = getStore().gapQuestions.find((x) => x.handoverId === CODECELL_ID && x.status === "open" && x.accessLevel === "everyone")!;
    const link = expectOk(await createGapInterviewLink({ handoverId: CODECELL_ID, questionIds: [q.id] }));
    const t = expectOk(await as(PROFILES.priya.id).listAccessTokens(CODECELL_ID)).find((x) => x.id === link.tokenId)!;
    assert.equal(t.maxUses, 20);
    assert.equal(t.maxAccessLevel, "everyone");
  });

  it("refuses questions more restricted than maxAccessLevel, and rejects maxUses as an input", async () => {
    const q = getStore().gapQuestions.find((x) => x.handoverId === CODECELL_ID)!;
    q.accessLevel = "leads_only";
    const err = expectError(await createGapInterviewLink({ handoverId: CODECELL_ID, questionIds: [q.id], maxAccessLevel: "everyone" }), "validation_failed");
    assert.ok(err.fieldErrors?.maxAccessLevel);
    expectOk(await createGapInterviewLink({ handoverId: CODECELL_ID, questionIds: [q.id], maxAccessLevel: "leads_only" }));
    // Repeated question ids are invalid (createGapLinkInput).
    const dup = { handoverId: CODECELL_ID, questionIds: [q.id, q.id] } satisfies CreateGapLinkInput;
    expectError(await createGapInterviewLink(dup), "validation_failed");
  });
});

describe("listParticipants and listExclusions (U2)", () => {
  beforeEach(() => resetStore());

  it("lists parsed participants to review roles with an identity kind and no hash", async () => {
    const list = expectOk(await as(PROFILES.arjun.id).listParticipants(CODECELL_ID));
    assert.ok(list.length >= 5);
    assert.ok(list.some((p) => p.identityKind === "phone") && list.some((p) => p.identityKind === "name"));
    for (const p of list) {
      assert.ok(!("identityHash" in p));
      assert.ok(!Object.values(p).some((v) => typeof v === "string" && IDENTITY_HASH_PATTERN.test(v)));
    }
  });

  it("is not_found for non-review roles", async () => {
    expectError(await as(PROFILES.neha.id).listParticipants(CODECELL_ID), "not_found");
    expectError(await as(PROFILES.kabir.id).listExclusions(CODECELL_ID), "not_found");
  });

  it("lists exclusions without naming the person", async () => {
    const list = expectOk(await as(PROFILES.priya.id).listExclusions(CODECELL_ID));
    const handoverWide = list.find((e) => e.kind === "participant");
    assert.equal(handoverWide?.scope, "handover");
    assert.equal(handoverWide?.sourceId, null);
    assert.equal(handoverWide?.identityKind, "phone");
    assert.equal(handoverWide?.requestedVia, "participant_request");
  });
});

describe("publishHandover returns PublicationSummary (U1)", () => {
  beforeEach(() => resetStore());

  it("includes the handover id and the new state", async () => {
    // Robotics is approved; revise and republish.
    const robotics = getStore().handovers.find((h) => h.title.startsWith("Robotics"))!;
    robotics.state = "in_review";
    const r = expectOk(await publishHandover({ handoverId: robotics.id }));
    assert.equal(r.handoverId, robotics.id);
    assert.equal(r.handoverState, "approved");
    assert.equal(r.version, 2);
  });
});
