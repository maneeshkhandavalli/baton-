import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { IDENTITY_HASH_PATTERN } from "../../contracts/identity";
import { EXCLUDED_PARTICIPANT_TOKEN, type SourcePreview } from "../../contracts/parser";
import type { AddExclusionInput } from "../../contracts/schemas";
import {
  addExclusion,
  confirmIdentityMatch,
  confirmSourceUploaded,
  createHandover,
  createSourceUpload,
  eraseParticipant,
  previewSource,
  recordSourceConsent,
  startProcessing,
} from "../actions";
import { CODECELL_ID } from "../fixtures/codecell";
import { PROFILES } from "../fixtures/profiles";
import { createMockQueries } from "../queries";
import { getStore } from "../store";
import { expectError, expectOk, resetStore, signInAs } from "./helpers";

const SHA = "a".repeat(64);

async function setUp() {
  const h = expectOk(await createHandover({ title: "Test handover", teamName: "Test team", creatorRole: "reviewer" }));
  const add = async (fileName: string, sizeBytes: number) => {
    const t = expectOk(await createSourceUpload({ handoverId: h.id, kind: "whatsapp_export", fileName, mimeType: "text/plain", sizeBytes, sha256: SHA }));
    expectOk(await confirmSourceUploaded({ sourceId: t.sourceId }));
    return t.sourceId;
  };
  const a = await add("WhatsApp Chat with Core Team.txt", 842_000);
  const b = await add("WhatsApp Chat with Event Volunteers.txt", 512_000);
  return { handoverId: h.id, a, b };
}

const person = (p: SourcePreview, label: string) => p.participants.find((x) => x.displayLabel === label);

async function consent(sourceId: string, preview: SourcePreview) {
  expectOk(await recordSourceConsent({ sourceId, consentStatementVersion: "v1", consentConfirmed: true, timezone: preview.parseContext.timezone }));
}

describe("previewSource returns the R8 SourcePreview (U3)", () => {
  beforeEach(() => resetStore());

  it("includes parserVersion, parseContext, identity kinds and 64-hex hashes", async () => {
    const { a } = await setUp();
    const p = expectOk(await previewSource({ sourceId: a }));
    assert.ok(p.parserVersion);
    assert.equal(p.parseContext.parserVersion, p.parserVersion);
    assert.equal(p.parseContext.dateOrder, "dmy");
    assert.deepEqual(p.identityMatches, []);
    for (const x of p.participants) {
      assert.match(x.identityHash, IDENTITY_HASH_PATTERN);
      assert.equal(x.identityPepperVersion, "p1");
      assert.equal(x.identityKind, /^Participant \d+$/.test(x.displayLabel) ? "phone" : "name");
    }
  });
});

describe("exclusions and identity matches (U1, U3, U9, D31–D33)", () => {
  beforeEach(() => resetStore());

  it("rejects the old provisional { sourceId, rule } shape", async () => {
    const { a } = await setUp();
    const legacy = { sourceId: a, rule: { kind: "conversation", conversationLocalId: "c_1" } } as unknown as AddExclusionInput;
    expectError(await addExclusion(legacy), "validation_failed");
  });

  it("drops an excluded participant from the preview and redacts their mentions", async () => {
    const { a } = await setUp();
    const before = expectOk(await previewSource({ sourceId: a }));
    const karan = person(before, "Karan Joshi")!;
    const r = expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "source", identityKind: karan.identityKind, participantIdentityHash: karan.identityHash, identityPepperVersion: karan.identityPepperVersion }),
    );
    assert.ok(r.exclusionId);
    const after = expectOk(await previewSource({ sourceId: a }));
    assert.equal(person(after, "Karan Joshi"), undefined);
    assert.ok(after.conversations.every((c) => !c.participantLocalIds.includes(karan.localId)));
    assert.ok(after.conversations.every((c) => !c.preview.includes("Karan Joshi")));
    assert.ok(after.conversations.some((c) => c.preview.includes(EXCLUDED_PARTICIPANT_TOKEN)));
    assert.ok(after.warnings.some((w) => w.code === "excluded_mentions_redacted"));
    assert.ok(after.stats.messagesExcluded > 0 && after.stats.messagesKept < before.stats.messagesKept);
    // The unique index: the same handover-wide identity can't be added twice.
    expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "handover", identityKind: karan.identityKind, participantIdentityHash: karan.identityHash, identityPepperVersion: karan.identityPepperVersion }),
    );
    expectError(
      await addExclusion({ kind: "participant", sourceId: a, scope: "handover", identityKind: karan.identityKind, participantIdentityHash: karan.identityHash, identityPepperVersion: karan.identityPepperVersion }),
      "conflict",
    );
  });

  it("only detects a handover-wide name exclusion in another chat until the creator decides", async () => {
    const { handoverId, a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    const karan = person(pa, "Karan Joshi")!;
    const name = { kind: "participant", sourceId: a, identityKind: "name", participantIdentityHash: karan.identityHash, identityPepperVersion: "p1" } as const;
    expectOk(await addExclusion({ ...name, scope: "source" }));
    const { exclusionId } = expectOk(await addExclusion({ ...name, scope: "handover" }));
    const leftOut = expectOk(await previewSource({ sourceId: a }));
    assert.equal(person(leftOut, "Karan Joshi"), undefined, "left out of the chat they were picked in, by the source rule");
    assert.deepEqual(leftOut.identityMatches, []);

    const pb = expectOk(await previewSource({ sourceId: b }));
    assert.ok(person(pb, "Karan Joshi"), "a name match is never applied silently");
    assert.deepEqual(pb.identityMatches.map((m) => [m.ruleId, m.identityKind]), [[exclusionId, "name"]]);

    await consent(a, leftOut);
    await consent(b, pb);
    const blocked = expectError(await startProcessing({ handoverId }), "precondition_failed");
    assert.equal(blocked.details?.errorCode, "identity_confirmation_required");

    expectOk(await confirmIdentityMatch({ sourceId: b, exclusionId, decision: "same_person" }));
    const confirmed = expectOk(await previewSource({ sourceId: b }));
    assert.equal(person(confirmed, "Karan Joshi"), undefined);
    assert.deepEqual(confirmed.identityMatches, []);
    expectOk(await startProcessing({ handoverId }));
  });

  it("keeps the person when the creator says it's someone else", async () => {
    const { a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    const karan = person(pa, "Karan Joshi")!;
    const { exclusionId } = expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "handover", identityKind: "name", participantIdentityHash: karan.identityHash, identityPepperVersion: "p1" }),
    );
    expectOk(await confirmIdentityMatch({ sourceId: b, exclusionId, decision: "different_person" }));
    const pb = expectOk(await previewSource({ sourceId: b }));
    assert.ok(person(pb, "Karan Joshi"));
    assert.deepEqual(pb.identityMatches, []);
  });

  it("only the creator confirms a match", async () => {
    const { handoverId, a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    const karan = person(pa, "Karan Joshi")!;
    const { exclusionId } = expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "handover", identityKind: "name", participantIdentityHash: karan.identityHash, identityPepperVersion: "p1" }),
    );
    // Not a member at all → the source is invisible.
    signInAs(PROFILES.kabir.id);
    expectError(await confirmIdentityMatch({ sourceId: b, exclusionId, decision: "same_person" }), "not_found");
    assert.ok(handoverId);
  });

  it("never applies a handover-wide name rule without a same_person decision, not even in the chat it was chosen in", async () => {
    const { a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    const karan = person(pa, "Karan Joshi")!;
    const { exclusionId } = expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "handover", identityKind: "name", participantIdentityHash: karan.identityHash, identityPepperVersion: "p1" }),
    );
    // Selecting someone for exclusion records no confirmation of any kind.
    assert.deepEqual(getStore().identityConfirmations, []);
    for (const id of [a, b]) {
      const p = expectOk(await previewSource({ sourceId: id }));
      assert.ok(person(p, "Karan Joshi"), "still in the preview");
      assert.deepEqual(p.identityMatches.map((m) => m.ruleId), [exclusionId]);
    }
  });

  it("persists one decision per source and exclusion, and a changed decision replaces it", async () => {
    const { a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    const karan = person(pa, "Karan Joshi")!;
    const { exclusionId } = expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "handover", identityKind: "name", participantIdentityHash: karan.identityHash, identityPepperVersion: "p1" }),
    );
    expectOk(await confirmIdentityMatch({ sourceId: b, exclusionId, decision: "same_person" }));
    assert.equal(person(expectOk(await previewSource({ sourceId: b })), "Karan Joshi"), undefined);
    // The decision for b says nothing about a.
    assert.ok(person(expectOk(await previewSource({ sourceId: a })), "Karan Joshi"));

    expectOk(await confirmIdentityMatch({ sourceId: b, exclusionId, decision: "different_person" }));
    const decisions = getStore().identityConfirmations.filter((c) => c.sourceId === b && c.exclusionId === exclusionId);
    assert.deepEqual(decisions.map((d) => d.decision), ["different_person"]);
    assert.equal(decisions[0].decidedBy, PROFILES.priya.id);
    const pb = expectOk(await previewSource({ sourceId: b }));
    assert.ok(person(pb, "Karan Joshi"));
    assert.deepEqual(pb.identityMatches, []);
  });

  it("applies a handover-wide phone rule to every chat without a decision", async () => {
    const { a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    const phone = pa.participants.find((p) => p.identityKind === "phone");
    assert.ok(phone, "the sample chat has a phone-number sender");
    expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "handover", identityKind: "phone", participantIdentityHash: phone.identityHash, identityPepperVersion: "p1" }),
    );
    assert.equal(expectOk(await previewSource({ sourceId: a })).participants.some((p) => p.identityHash === phone.identityHash), false);
    assert.deepEqual(expectOk(await previewSource({ sourceId: b })).identityMatches, []);
    assert.deepEqual(getStore().identityConfirmations, []);
  });

  it("only accepts a decision for a handover-wide name exclusion", async () => {
    const { a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    const karan = person(pa, "Karan Joshi")!;
    const { exclusionId } = expectOk(
      await addExclusion({ kind: "participant", sourceId: a, scope: "source", identityKind: "name", participantIdentityHash: karan.identityHash, identityPepperVersion: "p1" }),
    );
    expectError(await confirmIdentityMatch({ sourceId: b, exclusionId, decision: "same_person" }), "validation_failed");
  });

  it("attributes an exclusion to the acting session, not to anything in the input", async () => {
    const { handoverId, a } = await setUp();
    // Sana joins as a separate outgoing member (an uploader who is not the creator).
    getStore().members.push({ id: crypto.randomUUID(), handoverId, profileId: PROFILES.sana.id, displayName: PROFILES.sana.displayName, email: PROFILES.sana.email, role: "outgoing", clearance: "reviewer_only", ackRequired: false, removedAt: null });
    signInAs(PROFILES.sana.id);
    const pa = expectOk(await previewSource({ sourceId: a }));
    const spoofed = {
      kind: "conversation",
      sourceId: a,
      conversationLocalId: "c_2",
      parseContext: pa.parseContext,
      requestedBy: PROFILES.priya.id,
      requestedVia: "participant_request",
    } as unknown as AddExclusionInput;
    const { exclusionId } = expectOk(await addExclusion(spoofed));
    const row = getStore().exclusions.find((e) => e.id === exclusionId)!;
    assert.equal(row.requestedBy, PROFILES.sana.id);
    assert.equal(row.requestedVia, "uploader");
    // Members who can't manage sources can't record exclusions at all.
    signInAs(PROFILES.kabir.id);
    expectError(await addExclusion({ kind: "conversation", sourceId: a, conversationLocalId: "c_3", parseContext: pa.parseContext }), "not_found");
  });

  it("fails a conversation exclusion chosen on another parse context (D32)", async () => {
    const { handoverId, a, b } = await setUp();
    const pa = expectOk(await previewSource({ sourceId: a }));
    await consent(b, expectOk(await previewSource({ sourceId: b })));
    expectOk(await addExclusion({ kind: "conversation", sourceId: a, conversationLocalId: "c_5", parseContext: pa.parseContext }));
    const kept = expectOk(await previewSource({ sourceId: a }));
    assert.ok(!kept.conversations.some((c) => c.localId === "c_5"));

    expectOk(await addExclusion({ kind: "conversation", sourceId: a, conversationLocalId: "c_1", parseContext: { ...pa.parseContext, parserVersion: "0.0.1-old" } }));
    expectError(await previewSource({ sourceId: a }), "precondition_failed");
    await consent(a, pa);
    const err = expectError(await startProcessing({ handoverId }), "precondition_failed");
    assert.equal(err.details?.errorCode, "exclusion_context_mismatch");
  });
});

describe("eraseParticipant (§12.8)", () => {
  beforeEach(() => resetStore());

  it("is creator-only and fails honestly without a recovery receipt", async () => {
    const participants = expectOk(await createMockQueries(PROFILES.priya.id).listParticipants(CODECELL_ID));
    const target = participants[0];
    signInAs(PROFILES.arjun.id);
    expectError(await eraseParticipant({ handoverId: CODECELL_ID, participantId: target.id, confirm: true }), "forbidden");
    signInAs(PROFILES.priya.id);
    const err = expectError(await eraseParticipant({ handoverId: CODECELL_ID, participantId: target.id, confirm: true }), "precondition_failed");
    assert.equal(err.details?.reason, "recovery_receipt_unavailable");
    // Nothing changed.
    assert.equal(expectOk(await createMockQueries(PROFILES.priya.id).listParticipants(CODECELL_ID)).length, participants.length);
  });
});
