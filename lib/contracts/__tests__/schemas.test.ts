import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addExclusionInput,
  confirmIdentityMatchInput,
  createGapLinkInput,
  createGapQuestionInput,
  createHandoverInput,
  createManualPointInput,
  createSourceUploadInput,
  deleteAccountInput,
  extractedPointAttributesSchemas,
  inviteMemberInput,
  parsePointAttributes,
  recordSourceConsentInput,
  reviewPointInput,
  submitGapAnswersInput,
} from "../schemas";

const ID = "4f1c2a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const ID2 = "5a2b3c4d-6e7f-4a81-9b2c-3d4e5f6a7b8c";
const ID3 = "6b3c4d5e-7f80-4b92-8c3d-4e5f6a7b8c9d";
const SHA = "a".repeat(64);

describe("createHandoverInput", () => {
  const base = { title: "Treasurer handover", teamName: "Robotics Club" };

  it("accepts creatorRole outgoing or reviewer", () => {
    assert.ok(createHandoverInput.safeParse({ ...base, creatorRole: "outgoing" }).success);
    assert.ok(createHandoverInput.safeParse({ ...base, creatorRole: "reviewer" }).success);
  });

  it("rejects lead, incoming or a missing creatorRole (D23, no default)", () => {
    assert.equal(createHandoverInput.safeParse({ ...base, creatorRole: "lead" }).success, false);
    assert.equal(createHandoverInput.safeParse({ ...base, creatorRole: "incoming" }).success, false);
    assert.equal(createHandoverInput.safeParse(base).success, false);
  });
});

describe("createSourceUploadInput", () => {
  const base = { handoverId: ID, kind: "whatsapp_export", fileName: "chat.txt", mimeType: "text/plain", sha256: SHA };

  it("accepts a file up to 25 MB with a lowercase hex SHA-256", () => {
    assert.ok(createSourceUploadInput.safeParse({ ...base, sizeBytes: 25 * 1024 * 1024 }).success);
  });

  it("rejects files over 25 MB, empty files and fractional sizes", () => {
    assert.equal(createSourceUploadInput.safeParse({ ...base, sizeBytes: 25 * 1024 * 1024 + 1 }).success, false);
    assert.equal(createSourceUploadInput.safeParse({ ...base, sizeBytes: 0 }).success, false);
    assert.equal(createSourceUploadInput.safeParse({ ...base, sizeBytes: 10.5 }).success, false);
  });

  it("rejects malformed SHA-256 values", () => {
    for (const sha256 of ["a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
      assert.equal(createSourceUploadInput.safeParse({ ...base, sizeBytes: 10, sha256 }).success, false, sha256);
    }
  });
});

describe("recordSourceConsentInput", () => {
  it("requires explicit confirmation and defaults access to everyone", () => {
    const parsed = recordSourceConsentInput.parse({
      sourceId: ID,
      consentStatementVersion: "v1",
      consentConfirmed: true,
      timezone: "Asia/Kolkata",
    });
    assert.equal(parsed.accessLevel, "everyone");
    assert.equal(
      recordSourceConsentInput.safeParse({ sourceId: ID, consentStatementVersion: "v1", consentConfirmed: false, timezone: "UTC" })
        .success,
      false,
    );
  });
});

describe("category-specific PointAttributes (§3.1)", () => {
  it("accepts valid attributes and fills optional fields with null", () => {
    const result = parsePointAttributes("owner", { responsibility: "Runs the bank account" });
    assert.ok(result.success);
    if (result.success && result.data.category === "owner") {
      assert.equal(result.data.attributes.ownerLabel, null);
    }
  });

  it("requires the bold fields: owner.responsibility, contact.nameLabel, account_access.system", () => {
    assert.equal(parsePointAttributes("owner", {}).success, false);
    assert.equal(parsePointAttributes("contact", { organisation: "IEEE" }).success, false);
    assert.equal(parsePointAttributes("account_access", { holderLabel: "Asha" }).success, false);
  });

  it("rejects attributes that belong to another category", () => {
    assert.equal(parsePointAttributes("blocker", { responsibility: "x" }).success, false);
  });

  it("validates enums and ISO dates inside attributes", () => {
    assert.equal(parsePointAttributes("risk", { likelihood: "extreme" }).success, false);
    assert.equal(parsePointAttributes("open_task", { dueDate: "next friday" }).success, false);
    assert.ok(parsePointAttributes("open_task", { dueDate: "2026-12-01" }).success);
  });

  it("accepts a typed-in directContact but not several numbers in one field (D5)", () => {
    assert.ok(
      parsePointAttributes("contact", { nameLabel: "Faculty advisor", directContact: { channel: "email", value: "a@b.edu" } })
        .success,
    );
    assert.ok(
      parsePointAttributes("contact", { nameLabel: "Vendor", directContact: { channel: "phone", value: "+91 98765 43210" } })
        .success,
    );
    assert.equal(
      parsePointAttributes("contact", {
        nameLabel: "Vendor",
        directContact: { channel: "phone", value: "98765 43210 or 91234 56789" },
      }).success,
      false,
    );
  });

  it("rejects directContact in AI extraction output", () => {
    assert.ok(extractedPointAttributesSchemas.contact.safeParse({ nameLabel: "Vendor" }).success);
    assert.equal(
      extractedPointAttributesSchemas.contact.safeParse({
        nameLabel: "Vendor",
        directContact: { channel: "email", value: "a@b.edu" },
      }).success,
      false,
    );
  });
});

describe("reviewPointInput discriminated union", () => {
  it("accepts each ordinary action with its required fields", () => {
    const valid = [
      { action: "approve", pointId: ID, expectedRevisionId: ID2, confirmInferred: true },
      { action: "reject", pointId: ID, reason: "Duplicate" },
      { action: "reopen", pointId: ID },
      { action: "edit", pointId: ID, expectedRevisionId: ID2, title: "T", statement: "S", attributes: {}, editReason: "typo" },
      { action: "confirm_inferred", pointId: ID },
      { action: "resolve_conflict", pointId: ID, resolutionNote: "Newer message wins" },
      { action: "exclude_evidence", pointId: ID, pointEvidenceId: ID2, reason: "Wrong thread" },
      { action: "restore_evidence", pointId: ID, pointEvidenceId: ID2 },
      { action: "change_access", pointId: ID, accessOverride: "leads_only" },
    ];
    for (const input of valid) assert.ok(reviewPointInput.safeParse(input).success, input.action);
  });

  it("rejects unknown actions and missing action-specific fields", () => {
    assert.equal(reviewPointInput.safeParse({ action: "publish", pointId: ID }).success, false);
    assert.equal(reviewPointInput.safeParse({ action: "reject", pointId: ID }).success, false);
    assert.equal(reviewPointInput.safeParse({ action: "reject", pointId: ID, reason: "   " }).success, false);
    assert.equal(reviewPointInput.safeParse({ action: "resolve_conflict", pointId: ID, resolutionNote: "" }).success, false);
    assert.equal(reviewPointInput.safeParse({ action: "approve", pointId: "not-a-uuid", expectedRevisionId: ID2 }).success, false);
  });
});

describe("resolve_privacy_review (§5.5)", () => {
  const base = { action: "resolve_privacy_review", pointId: ID, expectedRevisionId: ID2, surfacesDigest: "d1" };
  const redacted = { title: "Treasurer holds the account", statement: "The treasurer manages it.", attributes: {} };

  it("keeps point decisions (keep/redact/withdraw) separate from surface decisions (keep/redact/remove)", () => {
    assert.ok(reviewPointInput.safeParse({ ...base, decision: "keep", surfaces: [] }).success);
    assert.equal(reviewPointInput.safeParse({ ...base, decision: "remove", surfaces: [] }).success, false);
    assert.equal(
      reviewPointInput.safeParse({
        ...base,
        decision: "keep",
        surfaces: [{ kind: "review_note", id: ID3, decision: "withdraw" }],
      }).success,
      false,
    );
  });

  it("requires replacement point text exactly when the point decision is redact", () => {
    assert.ok(reviewPointInput.safeParse({ ...base, decision: "redact", redacted, surfaces: [] }).success);
    assert.equal(reviewPointInput.safeParse({ ...base, decision: "redact", surfaces: [] }).success, false);
    assert.equal(reviewPointInput.safeParse({ ...base, decision: "keep", redacted, surfaces: [] }).success, false);
  });

  it("requires a surface replacement exactly when the surface decision is redact", () => {
    const withSurface = (surface: object) => reviewPointInput.safeParse({ ...base, decision: "keep", surfaces: [surface] });
    assert.ok(withSurface({ kind: "gap_answer", id: ID3, decision: "redact", replacement: { answer_text: "…" } }).success);
    assert.equal(withSurface({ kind: "gap_answer", id: ID3, decision: "redact" }).success, false);
    assert.equal(withSurface({ kind: "review_note", id: ID3, decision: "remove", replacement: { note: "x" } }).success, false);
    assert.ok(withSurface({ kind: "evidence_note", id: ID3, decision: "keep" }).success);
  });

  it("does not accept the point itself as a related surface", () => {
    assert.equal(
      reviewPointInput.safeParse({ ...base, decision: "keep", surfaces: [{ kind: "point", id: ID, decision: "keep" }] }).success,
      false,
    );
  });

  it("requires every earlier revision to be removed when the point is withdrawn", () => {
    const revisions = (decision: string) => [
      { kind: "revision", id: ID3, decision: "remove" },
      ...(decision === "remove"
        ? []
        : [{ kind: "revision", id: ID2, decision, ...(decision === "redact" ? { replacement: { title: "x" } } : {}) }]),
    ];
    assert.ok(reviewPointInput.safeParse({ ...base, decision: "withdraw", surfaces: revisions("remove") }).success);
    assert.equal(reviewPointInput.safeParse({ ...base, decision: "withdraw", surfaces: revisions("keep") }).success, false);
    assert.equal(reviewPointInput.safeParse({ ...base, decision: "withdraw", surfaces: revisions("redact") }).success, false);
    // Non-revision surfaces may still be kept when withdrawing.
    assert.ok(
      reviewPointInput.safeParse({
        ...base,
        decision: "withdraw",
        surfaces: [...revisions("remove"), { kind: "gap_answer", id: ID2, decision: "keep" }],
      }).success,
    );
  });

  it("requires the surfaces digest", () => {
    assert.equal(
      reviewPointInput.safeParse({ ...base, surfacesDigest: "", decision: "keep", surfaces: [] }).success,
      false,
    );
  });
});

describe("inviteMemberInput clearance rules (§6.3)", () => {
  const base = { handoverId: ID, email: "member@example.edu" };

  it("fixes outgoing and reviewer clearance at reviewer_only", () => {
    for (const role of ["outgoing", "reviewer"]) {
      assert.ok(inviteMemberInput.safeParse({ ...base, role }).success, role);
      assert.ok(inviteMemberInput.safeParse({ ...base, role, clearance: "reviewer_only" }).success, role);
      assert.equal(inviteMemberInput.safeParse({ ...base, role, clearance: "everyone" }).success, false, role);
      assert.equal(inviteMemberInput.safeParse({ ...base, role, clearance: "leads_only" }).success, false, role);
    }
  });

  it("lets the creator set clearance for incoming and lead members", () => {
    assert.ok(inviteMemberInput.safeParse({ ...base, role: "incoming", clearance: "leads_only" }).success);
    assert.ok(inviteMemberInput.safeParse({ ...base, role: "lead", clearance: "leads_only" }).success);
  });

  it("defaults the invitation to 7 days and caps it at 30", () => {
    assert.equal(inviteMemberInput.parse({ ...base, role: "incoming" }).expiresInDays, 7);
    assert.equal(inviteMemberInput.safeParse({ ...base, role: "incoming", expiresInDays: 31 }).success, false);
  });
});

describe("submitGapAnswersInput", () => {
  const answers = [{ gapQuestionId: ID, answerText: "Asha holds the UPI handle" }];

  it("requires a self-declared name when answering with a token", () => {
    const token = "t".repeat(43);
    assert.equal(submitGapAnswersInput.safeParse({ token, answers }).success, false);
    assert.ok(submitGapAnswersInput.safeParse({ token, answererLabel: "Ravi", answers }).success);
    assert.ok(submitGapAnswersInput.safeParse({ answers }).success); // signed-in session
  });
});

describe("addExclusionInput (§6.8, §10.3)", () => {
  const HASH = "c5eae44a7d1116bffa263282048a6f9e905fb8450dc368ae3c0d87ac7826da73";
  const participant = {
    kind: "participant",
    sourceId: ID,
    scope: "handover",
    identityKind: "name",
    participantIdentityHash: HASH,
    identityPepperVersion: "p1",
  };
  const context = { timezone: "Asia/Kolkata", dateOrder: "dmy", parserVersion: "1.0.0" };

  it("requires identity kind, a lower-case 64-hex hash and pepper version p1 for participants", () => {
    assert.ok(addExclusionInput.safeParse(participant).success);
    assert.equal(addExclusionInput.safeParse({ ...participant, identityKind: undefined }).success, false);
    assert.equal(addExclusionInput.safeParse({ ...participant, identityKind: "email" }).success, false);
    assert.equal(addExclusionInput.safeParse({ ...participant, participantIdentityHash: HASH.toUpperCase() }).success, false);
    assert.equal(addExclusionInput.safeParse({ ...participant, identityPepperVersion: "p2" }).success, false);
  });

  it("binds a conversation exclusion to its parse context and has no handover scope", () => {
    const conv = { kind: "conversation", sourceId: ID, conversationLocalId: "c_3", parseContext: context };
    assert.ok(addExclusionInput.safeParse(conv).success);
    assert.equal(addExclusionInput.safeParse({ ...conv, parseContext: undefined }).success, false);
    assert.equal(addExclusionInput.safeParse({ ...conv, conversationLocalId: "c_0" }).success, false);
    assert.equal(addExclusionInput.safeParse({ ...conv, parseContext: { ...context, parserVersion: "" } }).success, false);
    const parsed = addExclusionInput.parse({ ...conv, scope: "handover" });
    assert.equal("scope" in parsed, false); // stripped: conversations are always source-scoped
  });

  it("requires explicit offsets and an ordered date range", () => {
    const range = { kind: "date_range", sourceId: ID, scope: "source", rangeStart: "2026-01-01T00:00:00Z", rangeEnd: "2026-01-02T00:00:00+05:30" };
    assert.ok(addExclusionInput.safeParse(range).success);
    assert.equal(addExclusionInput.safeParse({ ...range, rangeStart: "2026-01-01T00:00:00" }).success, false);
    assert.equal(addExclusionInput.safeParse({ ...range, rangeStart: "2026-02-01T00:00:00Z" }).success, false);
  });

  it("accepts identity-match decisions", () => {
    assert.ok(confirmIdentityMatchInput.safeParse({ sourceId: ID, exclusionId: ID2, decision: "same_person" }).success);
    assert.equal(confirmIdentityMatchInput.safeParse({ sourceId: ID, exclusionId: ID2, decision: "maybe" }).success, false);
  });
});

describe("createManualPointInput (§3.1, D5)", () => {
  const base = { handoverId: ID, title: "Vendor contact", statement: "Ravi supplies the banners." };

  it("validates attributes against the category and types the output", () => {
    const parsed = createManualPointInput.parse({ ...base, category: "contact", attributes: { nameLabel: "Ravi" } });
    assert.equal(parsed.category, "contact");
    if (parsed.category === "contact") assert.equal(parsed.attributes.directContact, null);
    assert.equal(createManualPointInput.safeParse({ ...base, category: "contact", attributes: {} }).success, false);
    assert.equal(createManualPointInput.safeParse({ ...base, category: "risk", attributes: { nameLabel: "x" } }).success, false);
  });

  it("requires leads_only or stricter access for a typed-in direct contact", () => {
    const contact = { ...base, category: "contact", attributes: { nameLabel: "Ravi", directContact: { channel: "email", value: "r@x.org" } } };
    assert.equal(createManualPointInput.safeParse(contact).success, false);
    assert.equal(createManualPointInput.safeParse({ ...contact, accessOverride: "everyone" }).success, false);
    assert.ok(createManualPointInput.safeParse({ ...contact, accessOverride: "leads_only" }).success);
  });

  it("defaults testimony access to everyone", () => {
    const parsed = createManualPointInput.parse({
      ...base,
      category: "owner",
      attributes: { responsibility: "Banners" },
      testimony: { text: "I handled this myself." },
    });
    assert.equal(parsed.testimony?.accessLevel, "everyone");
  });
});

describe("createGapQuestionInput and createGapLinkInput (§6.15, §12.4)", () => {
  it("takes the category from the point when a point is given", () => {
    assert.ok(createGapQuestionInput.safeParse({ handoverId: ID, pointId: ID2, question: "Who holds the key?", priority: "required" }).success);
    assert.ok(createGapQuestionInput.safeParse({ handoverId: ID, category: "account_access", question: "Who holds the key?", priority: "optional" }).success);
    assert.equal(
      createGapQuestionInput.safeParse({ handoverId: ID, pointId: ID2, category: "owner", question: "Q", priority: "required" }).success,
      false,
    );
    assert.equal(createGapQuestionInput.parse({ handoverId: ID, question: "Q", priority: "optional" }).accessLevel, "everyone");
  });

  it("requires distinct questions and caps expiry at 30 days", () => {
    const parsed = createGapLinkInput.parse({ handoverId: ID, questionIds: [ID2, ID3] });
    assert.equal(parsed.expiresInDays, 7);
    assert.equal(parsed.maxAccessLevel, "everyone");
    assert.equal(createGapLinkInput.safeParse({ handoverId: ID, questionIds: [ID2, ID2] }).success, false);
    assert.equal(createGapLinkInput.safeParse({ handoverId: ID, questionIds: [] }).success, false);
    assert.equal(createGapLinkInput.safeParse({ handoverId: ID, questionIds: [ID2], expiresInDays: 31 }).success, false);
  });
});

describe("deleteAccountInput (D25, §12.9)", () => {
  it("requires the exact typed word DELETE", () => {
    assert.ok(deleteAccountInput.safeParse({ confirm: "DELETE", purgeHandoverIds: [] }).success);
    for (const confirm of [true, "delete", "DELETE ", "", undefined]) {
      assert.equal(deleteAccountInput.safeParse({ confirm, purgeHandoverIds: [] }).success, false, String(confirm));
    }
  });

  it("lists each handover marked for permanent deletion once", () => {
    assert.ok(deleteAccountInput.safeParse({ confirm: "DELETE", purgeHandoverIds: [ID, ID2] }).success);
    assert.equal(deleteAccountInput.safeParse({ confirm: "DELETE", purgeHandoverIds: [ID, ID] }).success, false);
    assert.equal(deleteAccountInput.safeParse({ confirm: "DELETE", purgeHandoverIds: ["not-a-uuid"] }).success, false);
  });
});

// ── AI output schemas (§10.6, §10.8, §11.8 rule 2) ───────────────────────────
import { extractionCandidateSchema, extractionResponseSchema, supportVerdictResponseSchema } from "../schemas";

describe("extractionCandidateSchema (§10.6)", () => {
  const MSG = "7c4d5e6f-8091-4ca3-9d4e-5f6a7b8c9d0e";
  const base = {
    category: "owner",
    title: "Treasurer owns the UPI account",
    statement: "[NAME_1] manages the club UPI account.",
    attributes: { responsibility: "UPI account", ownerLabel: null, since: null },
    citations: [{ messageId: MSG, quote: "I will keep handling the UPI account", stance: "supports" }],
    inferenceRationale: null,
  };

  it("accepts a well-formed candidate", () => {
    assert.equal(extractionCandidateSchema.safeParse(base).success, true);
  });
  it("rejects attributes of another category", () => {
    assert.equal(extractionCandidateSchema.safeParse({ ...base, attributes: { system: "UPI" } }).success, false);
  });
  it("rejects contact.directContact from extraction (D5)", () => {
    const contact = {
      ...base,
      category: "contact",
      attributes: { nameLabel: "Faculty advisor", directContact: { channel: "email", value: "a@b.co" } },
    };
    assert.equal(extractionCandidateSchema.safeParse(contact).success, false);
  });
  it("requires inferenceRationale when there are no citations", () => {
    assert.equal(extractionCandidateSchema.safeParse({ ...base, citations: [] }).success, false);
    assert.equal(extractionCandidateSchema.safeParse({ ...base, citations: [], inferenceRationale: "Implied by schedule" }).success, true);
  });
  it("rejects unknown keys, a non-uuid messageId and an over-long title", () => {
    assert.equal(extractionCandidateSchema.safeParse({ ...base, confidence: 0.9 }).success, false);
    assert.equal(extractionCandidateSchema.safeParse({ ...base, citations: [{ ...base.citations[0], messageId: "m1" }] }).success, false);
    assert.equal(extractionCandidateSchema.safeParse({ ...base, title: "x".repeat(121) }).success, false);
  });
  it("envelope is strict", () => {
    assert.equal(extractionResponseSchema.safeParse({ candidates: [] }).success, true);
    assert.equal(extractionResponseSchema.safeParse({ candidates: [], note: "hi" }).success, false);
  });
});

describe("supportVerdictResponseSchema (§10.8)", () => {
  it("accepts a verdict with a rationale and never 'unchecked'", () => {
    assert.equal(supportVerdictResponseSchema.safeParse({ verdict: "supports", rationale: "Directly states it." }).success, true);
    assert.equal(supportVerdictResponseSchema.safeParse({ verdict: "unchecked", rationale: "x" }).success, false);
    assert.equal(supportVerdictResponseSchema.safeParse({ verdict: "supports", rationale: "" }).success, false);
  });
});
