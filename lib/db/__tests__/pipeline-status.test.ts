// E4 (lead-approved contract change): the processing-status read model accepts the `partial` stage status
// that api_get_processing_status (migration 20261113300700) now returns, and still rejects anything else.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapProcessingStatus } from "../mappers";

const row = (status: string) => ({
  handover_state: "in_review",
  run: {
    id: "7c4d5e6f-8091-4ba3-8c4d-5e6f7a8b9c0d",
    status: "succeeded",
    started_at: "2026-11-13T00:00:00Z",
    finished_at: "2026-11-13T00:05:00Z",
    error: null,
    stages: [{ stage: "extract", status, done: 1, total: 2 }],
  },
  sources: [],
});

describe("processing status: stage states", () => {
  it("maps a partial stage", () => {
    assert.equal(mapProcessingStatus(row("partial")).run?.stages[0].status, "partial");
  });
  it("keeps every run status for stages", () => {
    for (const s of ["queued", "running", "succeeded", "failed", "cancelled"]) assert.equal(mapProcessingStatus(row(s)).run?.stages[0].status, s);
  });
  it("rejects an unknown stage status", () => {
    assert.throws(() => mapProcessingStatus(row("half_done")));
  });
});
