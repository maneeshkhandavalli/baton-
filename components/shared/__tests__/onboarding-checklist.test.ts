// Round 4 (Worker 02): the Getting Started checklist is derived only from real state (lib/onboarding/checklist.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AccessTokenSummary, HandoverSummary, MemberSummary, ProcessingStatus, PublishedHandover, ReadinessReport, SourceSummary } from "@/lib/contracts/dto";
import { creatorChecklist, incomingChecklist, type Checklist, type ChecklistLinks } from "@/lib/onboarding/checklist";

const LINKS: ChecklistLinks = {
  newHandover: "/new",
  draft: (id) => `/new?draft=${id}`,
  processing: (id) => `/p/${id}`,
  review: (id) => `/r/${id}`,
  gaps: (id) => `/g/${id}`,
  changes: (id) => `/c/${id}`,
  settings: (id) => `/s/${id}`,
  published: (id) => `/pub/${id}`,
};

const handover = (over: Partial<HandoverSummary> = {}): HandoverSummary => ({
  id: "h1",
  title: "Treasurer",
  teamName: "Robotics",
  roleTitle: null,
  description: null,
  state: "draft",
  viewerRole: "outgoing",
  viewerIsCreator: true,
  viewerClearance: "reviewer_only",
  currentPublicationId: null,
  pendingCreatorTransfer: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
  ...over,
});

const source = (over: Partial<SourceSummary> = {}): SourceSummary => ({
  id: "s1",
  handoverId: "h1",
  kind: "whatsapp_txt",
  title: "Chat",
  state: "uploaded",
  accessLevel: "reviewer_only",
  sizeBytes: 10,
  consentRecordedAt: null,
  rawDeletedAt: null,
  firstMessageAt: null,
  lastMessageAt: null,
  messageCount: null,
  maskingCounts: null,
  errorCode: null,
  ...over,
} as SourceSummary);

const readiness = (blockers: Partial<Record<ReadinessReport["blockers"][number]["kind"], number>>, decided = { approved: 0, rejected: 0, pending: 0 }, canPublish = false): ReadinessReport => ({
  canPublish,
  blockers: Object.entries(blockers).map(([kind, count]) => ({ kind: kind as ReadinessReport["blockers"][number]["kind"], count: count!, pointIds: [] })),
  counts: { byStatus: { sourced: 0, inferred: 0, conflicting: 0, missing: 0 }, byReviewState: decided, outdated: 0 },
  score: 0,
});

const status = (c: Checklist) => Object.fromEntries(c.items.map((i) => [i.id, i.status]));

describe("creator checklist", () => {
  it("a new user: create is the next action; everything else waits", () => {
    const c = creatorChecklist({ handover: null }, LINKS);
    assert.deepEqual(status(c), { create: "todo", sources: "locked", process: "locked", review: "locked", resolve: "locked", invite: "locked", publish: "locked" });
    assert.equal(c.next?.href, "/new");
    assert.equal(c.done, 0);
  });

  it("a draft without sources: create done, add a source next (in the wizard)", () => {
    const c = creatorChecklist({ handover: handover(), sources: [] }, LINKS);
    assert.equal(status(c).create, "done");
    assert.equal(c.next?.id, "sources");
    assert.equal(c.next?.href, "/new?draft=h1");
  });

  it("an upload that hasn't finished is not 'added'", () => {
    const c = creatorChecklist({ handover: handover(), sources: [source({ state: "pending_upload" })] }, LINKS);
    assert.equal(status(c).sources, "in_progress");
    assert.equal(status(c).process, "locked");
  });

  it("removed sources and pending versions never count", () => {
    const c = creatorChecklist({ handover: handover(), sources: [source({ state: "removed" }), source({ id: "s2", version: { lineageId: "s2", versionNumber: null, supersedesSourceId: null, supersededAt: null, supersededBySourceId: null } as SourceSummary["version"] })] }, LINKS);
    assert.equal(status(c).sources, "todo");
  });

  it("processing is in progress until the run finishes; a failure needs attention", () => {
    const running: ProcessingStatus = { handoverState: "processing", sources: [], run: { id: "r", status: "running", startedAt: null, finishedAt: null, stages: [], error: null } };
    const c = creatorChecklist({ handover: handover({ state: "processing" }), sources: [source({ state: "parsing" })], processing: running }, LINKS);
    assert.equal(status(c).process, "in_progress");
    assert.equal(status(c).review, "locked");
    const failed = creatorChecklist({ handover: handover(), sources: [source({ state: "parsed" })], processing: { ...running, handoverState: "draft", run: { ...running.run!, status: "failed" } } }, LINKS);
    assert.equal(status(failed).process, "attention");
    assert.equal(failed.next?.href, "/p/h1");
  });

  it("review is not done while any point is pending or inferred, nor when readiness couldn't be read", () => {
    const h = handover({ state: "in_review" });
    assert.equal(status(creatorChecklist({ handover: h, readiness: null }, LINKS)).review, "todo");
    const some = creatorChecklist({ handover: h, readiness: readiness({ pending_points: 2 }, { approved: 3, rejected: 0, pending: 2 }) }, LINKS);
    assert.equal(status(some).review, "in_progress");
    const inferred = creatorChecklist({ handover: h, readiness: readiness({ unconfirmed_inferred: 1 }, { approved: 3, rejected: 0, pending: 0 }) }, LINKS);
    assert.notEqual(status(inferred).review, "done");
    const done = creatorChecklist({ handover: h, readiness: readiness({}, { approved: 5, rejected: 1, pending: 0 }) }, LINKS);
    assert.equal(status(done).review, "done");
  });

  it("outstanding items link to where they are decided; source changes come first", () => {
    const h = handover({ state: "in_review" });
    const c = creatorChecklist({ handover: h, readiness: readiness({ unresolved_conflicts: 1, change_reviews_open: 2 }, { approved: 1, rejected: 0, pending: 0 }) }, LINKS);
    const resolve = c.items.find((i) => i.id === "resolve")!;
    assert.equal(resolve.status, "attention");
    assert.equal(resolve.href, "/c/h1");
    assert.match(resolve.detail, /1 conflict, 2 source changes to decide/);
    const gaps = creatorChecklist({ handover: h, readiness: readiness({ open_required_gaps: 1 }, { approved: 1, rejected: 0, pending: 0 }) }, LINKS);
    assert.equal(gaps.items.find((i) => i.id === "resolve")!.href, "/g/h1");
  });

  it("invite is done only by a joined incoming member or a live incoming invitation (or the database gate)", () => {
    const h = handover({ state: "in_review" });
    const r = readiness({ no_incoming_recipient: 1 }, { approved: 1, rejected: 0, pending: 0 });
    assert.equal(status(creatorChecklist({ handover: h, readiness: r, members: [], invites: [] }, LINKS)).invite, "todo");
    const expired = { purpose: "member_invite", status: "expired", grantRole: "incoming" } as AccessTokenSummary;
    assert.equal(status(creatorChecklist({ handover: h, readiness: r, invites: [expired] }, LINKS)).invite, "todo", "an expired invitation doesn't count");
    const reviewerInvite = { purpose: "member_invite", status: "active", grantRole: "reviewer" } as AccessTokenSummary;
    assert.equal(status(creatorChecklist({ handover: h, readiness: r, invites: [reviewerInvite] }, LINKS)).invite, "todo", "a reviewer invitation doesn't count");
    assert.equal(status(creatorChecklist({ handover: h, readiness: r, invites: [{ ...expired, status: "active" }] }, LINKS)).invite, "done");
    const joined = { id: "m", displayName: "Asha", role: "incoming", isViewer: false } as MemberSummary;
    const c = creatorChecklist({ handover: h, readiness: r, members: [joined] }, LINKS);
    assert.equal(status(c).invite, "done");
    assert.match(c.items.find((i) => i.id === "invite")!.detail, /Asha joined/);
  });

  it("publish is offered only when readiness allows it, and done only once published", () => {
    const h = handover({ state: "in_review" });
    assert.equal(status(creatorChecklist({ handover: h, readiness: readiness({ pending_points: 1 }) }, LINKS)).publish, "locked");
    const ready = creatorChecklist({ handover: h, readiness: readiness({}, { approved: 2, rejected: 0, pending: 0 }, true), invites: [{ purpose: "member_invite", status: "active", grantRole: "incoming" } as AccessTokenSummary] }, LINKS);
    assert.equal(status(ready).publish, "todo");
    assert.equal(ready.next?.id, "publish");
    assert.equal(ready.complete, false);
    const published = creatorChecklist({ handover: handover({ state: "approved", currentPublicationId: "p1" }) }, LINKS);
    assert.equal(published.complete, true, JSON.stringify(status(published)));
  });

  it("a reviewer who isn't the creator never sees invite or publish", () => {
    const c = creatorChecklist({ handover: handover({ state: "in_review", viewerIsCreator: false, viewerRole: "reviewer" }), readiness: readiness({}, { approved: 1, rejected: 0, pending: 0 }, true) }, LINKS);
    assert.deepEqual(c.items.map((i) => i.id), ["create", "sources", "process", "review", "resolve"]);
  });
});

describe("incoming checklist", () => {
  const pub = (over: Partial<PublishedHandover> = {}) => ({ publicationId: "p1", version: 1, viewerAcknowledgedAt: null, ...over }) as PublishedHandover;

  it("before publishing: joined, waiting for the team, nothing to do yet", () => {
    const c = incomingChecklist({ handover: handover({ state: "in_review", viewerRole: "incoming", viewerIsCreator: false }) }, LINKS);
    assert.deepEqual(status(c), { join: "done", published: "waiting", read: "locked", acknowledge: "locked" });
    assert.equal(c.next, null);
  });

  it("published: read it next; reading is recorded, acknowledging is the incoming member's last step", () => {
    const h = handover({ state: "approved", viewerRole: "incoming", viewerIsCreator: false, currentPublicationId: "p1" });
    let c = incomingChecklist({ handover: h, published: pub() }, LINKS);
    assert.equal(c.next?.id, "read");
    c = incomingChecklist({ handover: h, published: pub(), publishedOpenedAt: "2026-11-19T10:00:00Z" }, LINKS);
    assert.equal(c.next?.id, "acknowledge");
    assert.equal(c.next?.href, "/pub/h1#acknowledge");
    assert.equal(c.complete, false, "not complete until acknowledged");
    c = incomingChecklist({ handover: h, published: pub({ viewerAcknowledgedAt: "2026-11-19T11:00:00Z" }) }, LINKS);
    assert.equal(c.complete, true);
  });

  it("an unreadable publication never counts as acknowledged", () => {
    const h = handover({ state: "acknowledged", viewerRole: "incoming", viewerIsCreator: false, currentPublicationId: "p1" });
    assert.equal(status(incomingChecklist({ handover: h, published: null, publishedOpenedAt: "2026-11-19T10:00:00Z" }, LINKS)).acknowledge, "todo");
  });

  it("lead members read only: no acknowledgement item", () => {
    const h = handover({ state: "approved", viewerRole: "lead", viewerIsCreator: false, currentPublicationId: "p1" });
    const c = incomingChecklist({ handover: h, published: pub(), publishedOpenedAt: "2026-11-19T10:00:00Z" }, LINKS);
    assert.deepEqual(c.items.map((i) => i.id), ["join", "published", "read"]);
    assert.equal(c.complete, true);
  });
});
