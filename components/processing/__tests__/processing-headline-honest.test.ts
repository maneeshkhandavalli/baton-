// F2 (21 Nov): on the current hosting plan processing only advances while a Processing page is open, so the running
// headline must not promise background work ("You can leave this page"). Owned by the orchestrator.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processingHeadline } from "../processing-headline";

describe("processing headline: honest about background work", () => {
  it("asks the user to keep the page open while a run is active and never says they can leave", () => {
    const h = processingHeadline({ active: true, runStatus: "running", startedAt: "21 Nov 2026, 01:00", openReviews: 0, handoverState: "processing" } as never);
    assert.match(h.description, /Keep this page open/);
    assert.doesNotMatch(h.description, /leave this page|keeps working/i);
    assert.match(h.description, /Started 21 Nov 2026, 01:00/);
    assert.doesNotMatch(h.description, /[–—]/);
  });
});
