import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createHandoverInput,
  createSourceUploadInput,
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
