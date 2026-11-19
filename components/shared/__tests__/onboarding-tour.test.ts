// Round 4 (Worker 02): the product tour's steps, state machine and placement (lib/onboarding/tour.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CREATOR_TOUR,
  IDLE_TOUR,
  INCOMING_TOUR,
  currentStep,
  onStepPage,
  placeTourCard,
  resolveTourSteps,
  stepProgress,
  tourAvailable,
  tourReducer,
  type TourState,
  type TourStep,
} from "@/lib/onboarding/tour";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = { dashboard: "/dashboard", newHandover: "/handover/new", published: (id: string) => `/handover/${id}/published` };
const CTX = { focusHandoverId: null, published: false, acknowledges: false };

const steps = (n: number): TourStep[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, anchor: `a${i}`, page: "dashboard", title: `T${i}`, body: "b", href: "/dashboard" }));
const start = (n: number) => tourReducer(IDLE_TOUR, { type: "start", role: "creator", steps: steps(n) });
const at = (s: TourState) => currentStep(s)?.id ?? s.status;

describe("tour steps", () => {
  it("the creator tour needs no handover; it ends on the real 'create' action", () => {
    const s = resolveTourSteps("creator", CTX, PATHS);
    assert.deepEqual(s.map((x) => x.id), CREATOR_TOUR.map((x) => x.id));
    assert.equal(s.find((x) => x.id === "new-handover")?.advanceOnAnchorClick, true);
    assert.equal(s.at(-1)?.href, "/handover/new");
    assert.equal(tourAvailable(s), true);
  });

  it("the incoming tour needs a published handover; acknowledgement only for incoming members", () => {
    assert.equal(tourAvailable(resolveTourSteps("incoming", CTX, PATHS)), false, "only the help step is left");
    const lead = resolveTourSteps("incoming", { focusHandoverId: "h1", published: true, acknowledges: false }, PATHS);
    assert.ok(!lead.some((x) => x.id === "acknowledge"));
    const incoming = resolveTourSteps("incoming", { focusHandoverId: "h1", published: true, acknowledges: true }, PATHS);
    assert.deepEqual(incoming.map((x) => x.id), INCOMING_TOUR.map((x) => x.id));
    assert.equal(incoming[0].href, "/handover/h1/published");
  });

  it("matches a step's page by path only; 'any' pages match everywhere", () => {
    assert.equal(onStepPage({ href: "/dashboard" }, "/dashboard"), true);
    assert.equal(onStepPage({ href: "/dashboard" }, "/handover/new"), false);
    assert.equal(onStepPage({ href: null }, "/anything"), true);
  });

  it("every anchor a tour uses exists as a data-tour attribute in the components", () => {
    const files = [
      "app/(workspace)/dashboard/page.tsx",
      "components/dashboard/dashboard-view.tsx",
      "components/onboarding/getting-started.tsx",
      "components/onboarding/help-menu.tsx",
      "components/wizard/new-handover-wizard.tsx",
      "components/published/published-handover-view.tsx",
    ].map((f) => readFileSync(path.join(ROOT, f), "utf8"));
    const all = files.join("\n");
    // data-tour="x", or data-tour={cond ? "x" : undefined}
    for (const step of [...CREATOR_TOUR, ...INCOMING_TOUR]) assert.ok(new RegExp(`data-tour=(?:\{[^}]*)?"${step.anchor}"`).test(all), step.anchor);
  });

  it("copy is short and plain", () => {
    for (const s of [...CREATOR_TOUR, ...INCOMING_TOUR]) {
      assert.ok(s.title.length <= 40, s.id);
      assert.ok(s.body.length <= 220, s.id);
    }
  });
});

describe("tour state machine", () => {
  it("next, back and completion", () => {
    let s = start(3);
    assert.equal(at(s), "s0");
    assert.equal(tourReducer(s, { type: "back" }), s, "back on the first step does nothing");
    s = tourReducer(s, { type: "next" });
    assert.equal(at(s), "s1");
    assert.deepEqual(stepProgress(s), { position: 2, total: 3, label: "2 of 3" });
    s = tourReducer(s, { type: "back" });
    assert.equal(at(s), "s0");
    s = tourReducer(tourReducer(tourReducer(s, { type: "next" }), { type: "next" }), { type: "next" });
    assert.deepEqual(s, { status: "finished", role: "creator", outcome: "completed" });
  });

  it("skip/Escape dismisses from any step; events after finishing are ignored", () => {
    const s = tourReducer(tourReducer(start(3), { type: "next" }), { type: "dismiss" });
    assert.deepEqual(s, { status: "finished", role: "creator", outcome: "dismissed" });
    assert.equal(tourReducer(s, { type: "next" }), s);
    assert.equal(tourReducer(IDLE_TOUR, { type: "next" }), IDLE_TOUR);
  });

  it("replay: start again after finishing", () => {
    const done = tourReducer(start(1), { type: "next" });
    assert.equal(done.status, "finished");
    assert.equal(at(tourReducer(done, { type: "start", role: "creator", steps: steps(2) })), "s0");
    assert.equal(tourReducer(start(2), { type: "start", role: "creator", steps: [] }), IDLE_TOUR, "nothing to show");
  });

  it("a missing anchor is skipped in the direction of travel and dropped from the count", () => {
    let s = tourReducer(start(4), { type: "anchor_missing", stepId: "s0" });
    assert.equal(at(s), "s1");
    assert.equal(stepProgress(s)?.total, 3);
    s = tourReducer(tourReducer(s, { type: "next" }), { type: "next" }); // s3
    s = tourReducer(s, { type: "back" }); // s2, going back
    s = tourReducer(s, { type: "anchor_missing", stepId: "s2" });
    assert.equal(at(s), "s1", "going back skips backwards");
    assert.equal(tourReducer(s, { type: "anchor_missing", stepId: "stale" }), s, "a stale report is ignored");
  });

  it("missing anchors at the end complete the tour; all missing ends it quietly", () => {
    let s = tourReducer(start(2), { type: "next" });
    s = tourReducer(s, { type: "anchor_missing", stepId: "s1" });
    assert.deepEqual(s, { status: "finished", role: "creator", outcome: "completed" });
    s = tourReducer(start(1), { type: "anchor_missing", stepId: "s0" });
    assert.equal(s.status, "finished");
  });
});

describe("tour card placement", () => {
  const vp = { width: 1280, height: 800 };
  const card = { width: 320, height: 180 };
  const covers = (p: { top: number; left: number }, r: { top: number; left: number; width: number; height: number }) =>
    p.left < r.left + r.width && r.left < p.left + card.width && p.top < r.top + r.height && r.top < p.top + card.height;

  it("goes below the element when there is room, centred and inside the viewport", () => {
    const anchor = { top: 100, left: 600, width: 120, height: 40 };
    const p = placeTourCard(anchor, card, vp);
    assert.equal(p.side, "below");
    assert.ok(!covers(p, anchor));
    assert.ok(p.left >= 12 && p.left + card.width <= vp.width - 12);
  });

  it("goes above near the bottom, and never covers an avoided primary action", () => {
    const anchor = { top: 700, left: 600, width: 120, height: 40 };
    assert.equal(placeTourCard(anchor, card, vp).side, "above");
    const action = { top: 470, left: 0, width: 1280, height: 60 }; // a bar right above the anchor
    const p = placeTourCard(anchor, card, vp, [action]);
    assert.ok(!covers(p, anchor) && !covers(p, action), JSON.stringify(p));
  });

  it("on a phone, pins to the edge away from the element", () => {
    const phone = { width: 390, height: 760 };
    const wide = { width: 366, height: 220 };
    const nearTop = { top: 60, left: 20, width: 350, height: 420 };
    const p = placeTourCard(nearTop, wide, phone);
    assert.ok(p.top + wide.height <= phone.height - 12 && !(p.top < nearTop.top + nearTop.height && nearTop.top < p.top + wide.height), JSON.stringify(p));
    const tall = { top: 200, left: 20, width: 350, height: 520 }; // no room above or below
    assert.equal(placeTourCard(tall, wide, phone).side, "bottom-sheet", "keeps the element's heading visible");
    const lowTall = { top: 420, left: 20, width: 350, height: 330 };
    assert.equal(placeTourCard(lowTall, { width: 366, height: 430 }, phone).side, "top-sheet");
    // taller than the screen and its primary action near the top: the card goes to the other edge
    const action = { top: 40, left: 20, width: 350, height: 40 };
    assert.equal(placeTourCard({ top: 0, left: 20, width: 350, height: 800 }, wide, phone, [action]).side, "bottom-sheet");
  });
});
