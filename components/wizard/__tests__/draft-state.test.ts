// Draft resume regression tests (BTN-006/007): refresh and dashboard "Continue editing" reopen a draft
// from what the database holds, never from browser storage.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SourceSummary } from "@/lib/contracts/dto";

import { fromSummary, maxStepFor, resumeStep, signedTarget } from "../draft-state";

const src = (over: Partial<SourceSummary>): SourceSummary => ({
  id: "4f1c2a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  handoverId: "5a2b3c4d-6e7f-4a81-9b2c-3d4e5f6a7b8c",
  kind: "whatsapp_export",
  title: "WhatsApp Chat with Core Team.txt",
  state: "uploaded",
  accessLevel: "leads_only",
  sizeBytes: 1234,
  consentRecordedAt: null,
  rawDeletedAt: null,
  firstMessageAt: null,
  lastMessageAt: null,
  messageCount: null,
  maskingCounts: null,
  errorCode: null,
  ...over,
});

describe("fromSummary: a saved source after refresh", () => {
  it("an uploaded, consented source is previewed again and keeps its id and access level", () => {
    const d = fromSummary(src({ consentRecordedAt: "2026-11-12T10:00:00Z" }), true);
    assert.equal(d.status, "previewing");
    assert.equal(d.sourceId, "4f1c2a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b");
    assert.equal(d.accessLevel, "leads_only");
  });
  it("an uploaded source without consent records consent first when the checklist was given", () => {
    assert.equal(fromSummary(src({}), true).status, "consent");
  });
  it("an uploaded source without any consent is never previewed (the database would refuse)", () => {
    const d = fromSummary(src({}), false);
    assert.equal(d.status, "error");
    assert.match(d.error ?? "", /consent/i);
  });
  it("an unfinished upload is shown as such, with a way out", () => {
    const d = fromSummary(src({ state: "pending_upload" }), true);
    assert.equal(d.status, "error");
    assert.match(d.error ?? "", /didn't finish/);
  });
  it("never carries a File (nothing is restored from browser storage)", () => {
    assert.equal(fromSummary(src({ consentRecordedAt: "x" }), true).file, undefined);
  });
});

describe("resumeStep and maxStepFor", () => {
  it("uses the step from the URL when it is a whole number", () => {
    assert.equal(resumeStep("3", 2), 3);
    assert.equal(resumeStep("0", 0), 0);
  });
  it("falls back to consent for an empty draft and to sources for one with files", () => {
    assert.equal(resumeStep(undefined, 0), 1);
    assert.equal(resumeStep(undefined, 2), 2);
    assert.equal(resumeStep("abc", 1), 2);
    assert.equal(resumeStep("1.5", 0), 1);
  });
  it("never shows a step ahead of what the draft holds", () => {
    assert.equal(maxStepFor({ hasDraft: false, consentGiven: true, readySources: 3 }, 3), 0);
    assert.equal(maxStepFor({ hasDraft: true, consentGiven: false, readySources: 3 }, 3), 1);
    assert.equal(maxStepFor({ hasDraft: true, consentGiven: true, readySources: 0 }, 3), 2);
    assert.equal(maxStepFor({ hasDraft: true, consentGiven: true, readySources: 1 }, 3), 3);
  });
});

describe("signedTarget", () => {
  it("extracts bucket and object path from a Supabase signed upload URL", () => {
    assert.deepEqual(signedTarget("https://abc.supabase.co/storage/v1/object/upload/sign/source-uploads/raw/h1/s1?token=t"), {
      bucket: "source-uploads",
      path: "raw/h1/s1",
    });
  });
  it("rejects anything else", () => {
    assert.equal(signedTarget("https://abc.supabase.co/storage/v1/object/public/x"), null);
    assert.equal(signedTarget("not a url"), null);
  });
});
