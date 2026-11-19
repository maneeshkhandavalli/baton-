// Round 4 (Worker 02): onboarding components render real state, accessibly (react-dom/server, synthetic data).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GettingStartedView } from "../../components/onboarding/getting-started";
import { welcomeCopy } from "../../components/onboarding/welcome";
import type { HandoverSummary } from "../../lib/contracts/dto";
import { creatorChecklist, incomingChecklist, type ChecklistLinks } from "../../lib/onboarding/checklist";

const LINKS: ChecklistLinks = {
  newHandover: "/handover/new",
  draft: (id) => `/handover/new?draft=${id}`,
  processing: (id) => `/handover/${id}/processing`,
  review: (id) => `/handover/${id}/review`,
  gaps: (id) => `/handover/${id}/gaps`,
  changes: (id) => `/handover/${id}/changes`,
  settings: (id) => `/handover/${id}/settings`,
  published: (id) => `/handover/${id}/published`,
};

const h = (over: Partial<HandoverSummary>): HandoverSummary => ({
  id: "h1",
  title: "Treasurer <b>handover</b>",
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

describe("Getting started checklist (render)", () => {
  it("a new user: one next action, everything else not available yet, statuses spoken", () => {
    const html = renderToStaticMarkup(createElement(GettingStartedView, { checklist: creatorChecklist({ handover: null }, LINKS) }));
    assert.match(html, /data-tour="checklist"/);
    assert.match(html, /0 of 7 done/);
    assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1, "exactly one next step");
    assert.match(html, /href="\/handover\/new"/);
    assert.match(html, /Not available yet/);
    assert.match(html, /role="progressbar"[^>]*aria-valuenow="0"/);
  });

  it("escapes handover titles and links only to the real pages", () => {
    const html = renderToStaticMarkup(createElement(GettingStartedView, { checklist: creatorChecklist({ handover: h({}), sources: [] }, LINKS) }));
    assert.doesNotMatch(html, /<b>handover<\/b>/);
    assert.match(html, /&lt;b&gt;handover/);
    assert.match(html, /href="\/handover\/new\?draft=h1"/);
  });

  it("incoming member before publishing: nothing to click, says the team is still reviewing", () => {
    const c = incomingChecklist({ handover: h({ viewerRole: "incoming", viewerIsCreator: false, state: "in_review" }) }, LINKS);
    const html = renderToStaticMarkup(createElement(GettingStartedView, { checklist: c }));
    assert.match(html, /still reviewing/);
    assert.doesNotMatch(html, /aria-current="step"/);
    assert.doesNotMatch(html, /Create a handover|Publish the handover/, "never the creator's guidance");
  });
});

describe("welcome copy", () => {
  it("is role-aware and mentions acknowledgement only for members who acknowledge", () => {
    const creator = welcomeCopy("creator", { tourAvailable: true, acknowledges: false });
    assert.match(creator.points.map((p) => p.text).join(" "), /invite the incoming person and publish/);
    const lead = welcomeCopy("incoming", { tourAvailable: true, acknowledges: false });
    assert.doesNotMatch(lead.points.map((p) => p.text).join(" "), /acknowledge/i);
    const incoming = welcomeCopy("incoming", { tourAvailable: false, acknowledges: true });
    assert.match(incoming.points.map((p) => p.text).join(" "), /acknowledge it/);
    assert.equal(incoming.tourLabel, null, "no tour offered before there is something to read");
  });
});
