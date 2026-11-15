import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HandoverSummary, ReadinessReport } from "@/lib/contracts/dto";

import { attentionQueue, classify, filterRows, groupActivityByDay, relativeTime, resumeTarget, sortRows, stageOf, type ActivityItem, type DashboardLinks } from "../model";

const LINKS: DashboardLinks = {
  review: (id) => `/r/${id}`,
  processing: (id) => `/p/${id}`,
  published: (id) => `/pub/${id}`,
  gaps: (id) => `/g/${id}`,
  settings: (id) => `/s/${id}`,
  draft: (id, step) => `/new?draft=${id}&step=${step}`,
  offers: "/account",
};

const base = (over: Partial<HandoverSummary> = {}): HandoverSummary => ({
  id: "h1",
  title: "Treasurer",
  teamName: "Robotics",
  roleTitle: null,
  description: null,
  state: "in_review",
  viewerRole: "outgoing",
  viewerIsCreator: true,
  viewerClearance: "reviewer_only",
  currentPublicationId: null,
  pendingCreatorTransfer: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
  ...over,
});

const readiness = (blockers: ReadinessReport["blockers"], canPublish = false): ReadinessReport => ({
  canPublish,
  blockers,
  counts: { byStatus: { sourced: 1, inferred: 0, conflicting: 0, missing: 0 }, byReviewState: { pending: 3, approved: 1, rejected: 0 }, outdated: 0 } as ReadinessReport["counts"],
  score: 25,
});

describe("dashboard classify()", () => {
  it("maps every handover state to a stage", () => {
    assert.deepEqual(["draft", "processing", "in_review", "approved", "acknowledged"].map((s) => stageOf(s as HandoverSummary["state"])), ["draft", "processing", "review", "published", "acknowledged"]);
  });

  it("turns review blockers into attention items with counts, conflicts before pending review", () => {
    const row = classify({ summary: base(), readiness: readiness([{ kind: "pending_points", count: 3, pointIds: [] }, { kind: "unresolved_conflicts", count: 1, pointIds: [] }]) }, LINKS);
    assert.deepEqual(row.attention.map((a) => a.kind), ["conflicts", "review"]);
    assert.equal(row.health, "blocked");
    assert.equal(row.href, "/r/h1");
    assert.match(row.status, /3 to review · 1 conflict/);
    assert.equal(row.progressLabel, "1 of 4 points decided");
  });

  it("flags a failed processing run for the preparing side", () => {
    const row = classify({ summary: base({ state: "processing" }), processing: { handoverState: "processing", sources: [], run: { id: "r", status: "failed", startedAt: null, finishedAt: null, stages: [], error: null } } }, LINKS);
    assert.equal(row.health, "failed");
    assert.equal(row.attention[0].kind, "failed");
    assert.equal(row.href, "/p/h1");
  });

  it("resumes a draft at its next wizard step", () => {
    const row = classify({ summary: base({ state: "draft" }), draft: { step: 3, steps: ["a", "b", "c", "d"], sources: 2 } }, LINKS);
    assert.equal(row.status, "Step 3 of 4: c");
    assert.equal(row.href, "/new?draft=h1&step=3");
    assert.equal(resumeTarget([row])?.id, "h1");
  });

  it("asks an incoming member to acknowledge a published handover", () => {
    const row = classify({ summary: base({ state: "approved", viewerRole: "incoming", viewerIsCreator: false }) }, LINKS);
    assert.equal(row.side, "receiving");
    assert.equal(row.attention[0].kind, "acknowledge");
    assert.equal(row.href, "/pub/h1");
  });

  it("puts a creatorship offer to the viewer first", () => {
    const row = classify({ summary: base({ viewerIsCreator: false, pendingCreatorTransfer: { toMemberId: "m", offeredAt: "2026-11-09T00:00:00Z" } }), readiness: readiness([{ kind: "pending_points", count: 1, pointIds: [] }]) }, LINKS);
    assert.equal(row.attention[0].kind, "offer");
    assert.equal(row.attention[0].href, "/account");
  });

  it("offers Publish when the creator can publish", () => {
    const row = classify({ summary: base(), readiness: readiness([], true) }, LINKS);
    assert.equal(row.status, "Ready to publish");
    assert.equal(row.cta, "Publish");
  });
});

describe("dashboard filtering and ordering", () => {
  const rows = sortRows([
    classify({ summary: base({ id: "a", title: "Alpha", state: "acknowledged", updatedAt: "2026-11-12T00:00:00Z" }) }, LINKS),
    classify({ summary: base({ id: "b", title: "Beta", teamName: "CodeCell" }), readiness: readiness([{ kind: "unresolved_conflicts", count: 2, pointIds: [] }]) }, LINKS),
    classify({ summary: base({ id: "c", title: "Gamma", state: "approved", viewerRole: "incoming", viewerIsCreator: false }) }, LINKS),
  ]);

  it("sorts urgent work first", () => {
    assert.deepEqual(rows.map((r) => r.id), ["b", "c", "a"]);
    assert.equal(attentionQueue(rows)[0].handoverId, "b");
  });

  it("filters by status, side and words (all words must match)", () => {
    assert.deepEqual(filterRows(rows, { status: "attention", side: "all", query: "" }).map((r) => r.id), ["b", "c"]);
    assert.deepEqual(filterRows(rows, { status: "all", side: "receiving", query: "" }).map((r) => r.id), ["c"]);
    assert.deepEqual(filterRows(rows, { status: "all", side: "all", query: "beta codecell" }).map((r) => r.id), ["b"]);
    assert.deepEqual(filterRows(rows, { status: "acknowledged", side: "all", query: "zzz" }), []);
  });

  it("formats relative time deterministically", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    assert.equal(relativeTime("2026-11-15T11:59:40Z", now), "just now");
    assert.equal(relativeTime("2026-11-15T11:30:00Z", now), "30 min ago");
    assert.equal(relativeTime("2026-11-14T12:00:00Z", now), "yesterday");
    assert.equal(relativeTime("not a date", now), "");
  });
});

describe("activity timeline grouping", () => {
  it("buckets by local calendar day in a fixed order and skips bad dates", () => {
    const now = new Date(2026, 10, 15, 12, 0);
    const item = (id: string, at: Date | string): ActivityItem => ({ id, at: typeof at === "string" ? at : at.toISOString(), text: "x", handover: "h", href: "/", tone: "neutral" });
    const groups = groupActivityByDay(
      [item("a", new Date(2026, 10, 15, 9)), item("b", new Date(2026, 10, 14, 22)), item("c", new Date(2026, 10, 11, 8)), item("d", new Date(2026, 9, 1)), item("e", "nope")],
      now,
    );
    assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [["Today", ["a"]], ["Yesterday", ["b"]], ["Earlier this week", ["c"]], ["Earlier", ["d"]]]);
  });
});
