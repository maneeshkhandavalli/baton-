import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HandoverSummary, ReadinessReport } from "@/lib/contracts/dto";

import { attentionByHandover, attentionQueue, classify, filterRows, groupActivityByDay, relativeTime, resumeTarget, sortRows, stageOf, type ActivityItem, type DashboardLinks, type QueuedAttention } from "../model";

const LINKS: DashboardLinks = {
  review: (id) => `/r/${id}`,
  processing: (id) => `/p/${id}`,
  published: (id) => `/pub/${id}`,
  gaps: (id) => `/g/${id}`,
  settings: (id) => `/s/${id}`,
  draft: (id, step) => `/new?draft=${id}&step=${step}`,
  offers: () => "/account",
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

  it("QA-UI3-D1: a draft whose run failed says so and asks for attention (not 'not started yet')", () => {
    const run = (status: "failed" | "cancelled") => ({ handoverState: "draft" as const, sources: [], run: { id: "r", status, startedAt: null, finishedAt: null, stages: [], error: null } });
    const failed = classify({ summary: base({ state: "draft" }), processing: run("failed") } as Parameters<typeof classify>[0], LINKS);
    assert.equal(failed.health, "failed");
    assert.equal(failed.status, "Processing stopped before finishing");
    assert.equal(failed.attention[0]?.kind, "failed");
    assert.equal(failed.href, "/p/h1");
    const cancelled = classify({ summary: base({ state: "draft" }), processing: run("cancelled") } as Parameters<typeof classify>[0], LINKS);
    assert.equal(cancelled.status, "Processing cancelled · start again when ready");
    assert.equal(cancelled.attention.length, 0);
    const fresh = classify({ summary: base({ state: "draft" }) }, LINKS);
    assert.equal(fresh.status, "Sources added · not started yet");
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

  it("never offers Publish to a reviewer who is not the creator", () => {
    const row = classify({ summary: base({ viewerIsCreator: false, viewerRole: "reviewer" }), readiness: readiness([], true) }, LINKS);
    assert.equal(row.status, "Ready · the creator publishes");
    assert.equal(row.cta, "Open review");
    assert.ok(!row.attention.some((a) => a.kind === "publish"));
  });

  it("says when publishing waits for an incoming person, and links the creator to Members", () => {
    const blocked = readiness([{ kind: "no_incoming_recipient", count: 1, pointIds: [] }]);
    const row = classify({ summary: base(), readiness: blocked }, LINKS);
    assert.match(row.status, /no incoming person invited yet/);
    const invite = row.attention.find((a) => a.kind === "invite");
    assert.ok(invite, "an Invite item");
    assert.equal(invite.href, "/s/h1#members");
    const reviewer = classify({ summary: base({ viewerIsCreator: false, viewerRole: "reviewer" }), readiness: blocked }, LINKS);
    assert.ok(!reviewer.attention.some((a) => a.kind === "invite"), "only the creator invites");
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

// R3 Task 06: "Up next" shows each handover once, led by its most urgent item.
describe("attentionByHandover", () => {
  const q = (handoverId: string, kind: QueuedAttention["kind"], label: string, rank: number): QueuedAttention => ({
    kind,
    label,
    reason: `${label} reason`,
    cta: label,
    href: `/${handoverId}/${kind}`,
    rank,
    handoverId,
    title: `T ${handoverId}`,
    team: "Team",
  });
  it("keeps queue order, one entry per handover, the rest summarised by label", () => {
    const out = attentionByHandover([
      q("a", "conflicts", "Conflicts", 2),
      q("b", "review", "Review", 3),
      q("a", "review", "Review", 3),
      q("a", "gaps", "Gap questions", 4),
      q("a", "gaps", "Gap questions", 4),
    ]);
    assert.deepEqual(
      out.map((o) => [o.handoverId, o.kind, o.also]),
      [
        ["a", "conflicts", ["Review", "Gap questions"]],
        ["b", "review", []],
      ],
    );
  });
  it("an empty queue stays empty", () => assert.deepEqual(attentionByHandover([]), []));
});

describe("Round 4 audit fixes (A1, F10)", () => {
  it("labels a published (approved) handover 'Published', never 'Approved'", async () => {
    const { handoverStateMeta } = await import("@/components/handover/labels");
    assert.equal(handoverStateMeta.approved.label, "Published");
  });

  const run = (stages: NonNullable<import("@/lib/contracts/dto").ProcessingStatus["run"]>["stages"]) => ({
    handoverState: "processing" as const,
    sources: [],
    run: { id: "r", status: "running" as const, startedAt: null, finishedAt: null, stages, error: null },
  });

  it("names the stage that is actually running, not always 'Reading sources'", async () => {
    const { processingStatusLine } = await import("../model");
    const row = classify(
      {
        summary: base({ state: "processing" }),
        processing: run([
          { stage: "parse", status: "succeeded", done: 1, total: 1 },
          { stage: "extract", status: "succeeded", done: 2, total: 2 },
          { stage: "verify_quotes", status: "running", done: 1, total: 3 },
          { stage: "verify_support", status: "queued", done: 0, total: 3 },
        ]),
      },
      LINKS,
    );
    assert.equal(row.status, "Checking quotes exist · stage 3 of 4");
    assert.equal(processingStatusLine([]), "Starting processing");
    assert.equal(processingStatusLine([{ stage: "parse", status: "queued", done: 0, total: 1 }]), "Reading sources · stage 1 of 1");
    assert.equal(
      processingStatusLine([
        { stage: "parse", status: "succeeded", done: 1, total: 1 },
        { stage: "extract", status: "queued", done: 0, total: 1 },
      ]),
      "Extracting knowledge · stage 2 of 2",
    );
    assert.equal(processingStatusLine([{ stage: "parse", status: "succeeded", done: 1, total: 1 }]), "Finishing up");
  });

  it("keeps refreshing only while some handover is processing", async () => {
    const { hasRunningProcessing } = await import("../model");
    const processing = classify({ summary: base({ state: "processing" }), processing: run([{ stage: "parse", status: "running", done: 0, total: 1 }]) }, LINKS);
    const review = classify({ summary: base({ id: "h2" }) }, LINKS);
    assert.equal(hasRunningProcessing([processing, review]), true);
    assert.equal(hasRunningProcessing([review]), false);
  });
});
