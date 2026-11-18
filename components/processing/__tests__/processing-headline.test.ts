// R3 Task 06: the processing page never claims more than is true (components/processing/processing-headline.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processingHeadline, type HeadlineInput } from "../processing-headline";

const base = (over: Partial<HeadlineInput> = {}): HeadlineInput => ({
  active: false,
  runStatus: "succeeded",
  startedAt: null,
  finishedAt: "18 Nov 2026, 19:52",
  pendingUpdates: 0,
  openReviews: 0,
  handoverState: "in_review",
  ...over,
});

describe("processingHeadline", () => {
  it("running", () => {
    const h = processingHeadline(base({ active: true, runStatus: "running", startedAt: "18 Nov 2026, 19:50" }));
    assert.equal(h.title, "Processing your sources");
    assert.match(h.description, /Started 18 Nov 2026, 19:50/);
  });

  it("never 'complete' while a source update is unprocessed or its changes are undecided", () => {
    assert.equal(processingHeadline(base({ pendingUpdates: 1 })).title, "A source update needs processing");
    assert.equal(processingHeadline(base({ pendingUpdates: 2 })).title, "Source updates need processing");
    assert.match(processingHeadline(base({ pendingUpdates: 2 })).description, /2 newer source versions/);
    const c = processingHeadline(base({ openReviews: 3 }));
    assert.equal(c.title, "Processed · changes to review");
    assert.match(c.description, /3 changes that need a decision/);
  });

  it("complete: invites a review only while the handover is in review", () => {
    assert.match(processingHeadline(base()).description, /ready for your review/);
    assert.doesNotMatch(processingHeadline(base({ handoverState: "approved" })).description, /ready for your review/);
    assert.match(processingHeadline(base({ handoverState: "approved" })).description, /since been published/);
    assert.match(processingHeadline(base({ handoverState: "acknowledged" })).description, /acknowledged/);
  });

  it("failed, cancelled and not started", () => {
    assert.equal(processingHeadline(base({ runStatus: "failed" })).title, "Processing failed");
    assert.equal(processingHeadline(base({ runStatus: "cancelled", handoverState: "draft" })).title, "Processing cancelled");
    assert.equal(processingHeadline(base({ runStatus: null, handoverState: "draft" })).description, "Add consent for every source, then start processing.");
  });
});
