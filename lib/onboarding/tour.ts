/**
 * Round 4 (Worker 02): the interactive product tour, as data plus a pure state machine and placement maths.
 * React-free (components/shared/__tests__/onboarding-tour.test.ts); the overlay is components/onboarding/tour.tsx.
 *
 * Each step highlights ONE real element, found by its stable `data-tour="<anchor>"` attribute, on the page named
 * by `page`. A step whose page needs a handover the user doesn't have, or whose role condition doesn't hold, is
 * left out before the tour starts (resolveTourSteps); a step whose element isn't on the page when it is reached is
 * skipped in the direction of travel (the "anchor_missing" event). Steps can wait for the real action: with
 * `advanceOnAnchorClick`, pressing the highlighted control itself moves the tour on (e.g. "New handover").
 */

import type { GuideRole } from "./state";

export type TourPage = "dashboard" | "new_handover" | "published" | "any";

export interface TourStepDef {
  id: string;
  anchor: string;
  page: TourPage;
  title: string;
  body: string;
  /** Pressing the highlighted control is the step's action and moves the tour to the next step. */
  advanceOnAnchorClick?: boolean;
  /** The label of the Next button when it performs the step's action (e.g. "Start a handover"). */
  nextLabel?: string;
  /** Only for incoming members who acknowledge (not lead members). */
  requiresAcknowledgement?: boolean;
  /** May be absent on the page (e.g. "Up next" when nothing needs you); skipped quietly then. */
  optional?: boolean;
}

export const CREATOR_TOUR: readonly TourStepDef[] = [
  {
    id: "checklist",
    anchor: "checklist",
    page: "dashboard",
    title: "Your progress, from real data",
    body: "This list follows your actual handover: sources added, processing finished, points reviewed, someone invited, published. Items tick themselves only when they're really done.",
  },
  {
    id: "up-next",
    anchor: "up-next",
    page: "dashboard",
    optional: true,
    title: "What needs you",
    body: "One row per handover, with the single most useful thing to do next.",
  },
  {
    id: "help",
    anchor: "help-menu",
    page: "any",
    title: "Help is always here",
    body: "Replay this tour, reopen the checklist, or look up what a term means. Small ? buttons next to headings explain them too.",
  },
  {
    id: "new-handover",
    anchor: "new-handover",
    page: "dashboard",
    advanceOnAnchorClick: true,
    nextLabel: "Start a handover",
    title: "Start a handover",
    body: "A handover gathers what your team knows so the next person can trust it. Press New handover to begin; your draft saves as you go.",
  },
  {
    id: "wizard-steps",
    anchor: "wizard-steps",
    page: "new_handover",
    title: "Four short steps",
    body: "Details, consent, the team's chats and documents, then what Baton may read. Nothing is read until you start processing.",
  },
  {
    id: "wizard-details",
    anchor: "wizard-details",
    page: "new_handover",
    title: "Begin with the details",
    body: "Give it a title and the team, then say whether you're the person leaving. Press Create draft when you're ready.",
  },
];

export const INCOMING_TOUR: readonly TourStepDef[] = [
  {
    id: "published-header",
    anchor: "published-header",
    page: "published",
    title: "Your handover",
    body: "What the outgoing team prepared for you: who published it, which version, and a short summary.",
  },
  {
    id: "first-week",
    anchor: "first-week",
    page: "published",
    optional: true,
    title: "Start with your first 7 days",
    body: "Concrete things to do first, taken from the handover. Tick them off as you go; the ticks stay on this device.",
  },
  {
    id: "sections",
    anchor: "published-sections",
    page: "published",
    optional: true,
    title: "What to know",
    body: "Decisions, owners, access and risks, each with the message it came from. Open a quote to see the evidence.",
  },
  {
    id: "open-questions",
    anchor: "open-questions",
    page: "published",
    optional: true,
    title: "What nobody knew",
    body: "Questions the team couldn't answer. Ask about these early.",
  },
  {
    id: "acknowledge",
    anchor: "acknowledge",
    page: "published",
    requiresAcknowledgement: true,
    title: "Confirm you have it",
    body: "When you've read it, acknowledge it here so the outgoing team knows the handover reached you.",
  },
  {
    id: "help",
    anchor: "help-menu",
    page: "any",
    title: "Help is always here",
    body: "Replay this tour, see your checklist, or look up what a term means.",
  },
];

export const TOURS: Readonly<Record<GuideRole, readonly TourStepDef[]>> = { creator: CREATOR_TOUR, incoming: INCOMING_TOUR };

export interface TourContext {
  /** The handover a page-bound step is about (resolveGuideRoles focus); null when none. */
  focusHandoverId: string | null;
  /** Incoming tour: the focus handover is published (otherwise there is nothing to tour). */
  published: boolean;
  /** Incoming tour: the viewer is an incoming member (lead members don't acknowledge). */
  acknowledges: boolean;
}

export interface TourStep extends TourStepDef {
  /** Where the step lives, or null for "any page". */
  href: string | null;
}

export interface TourPaths {
  dashboard: string;
  newHandover: string;
  published: (id: string) => string;
}

/** The steps this user can actually be shown, with their page's path. */
export function resolveTourSteps(role: GuideRole, ctx: TourContext, paths: TourPaths): TourStep[] {
  const out: TourStep[] = [];
  for (const def of TOURS[role]) {
    if (def.requiresAcknowledgement && !ctx.acknowledges) continue;
    let href: string | null;
    if (def.page === "dashboard") href = paths.dashboard;
    else if (def.page === "new_handover") href = paths.newHandover;
    else if (def.page === "published") {
      if (!ctx.focusHandoverId || !ctx.published) continue;
      href = paths.published(ctx.focusHandoverId);
    } else href = null;
    out.push({ ...def, href });
  }
  return out;
}

/** Whether a tour has anything meaningful to show (the help step alone is not a tour). */
export function tourAvailable(steps: readonly TourStep[]): boolean {
  return steps.some((s) => s.page !== "any");
}

/** A path matches a step's page (ignoring query and hash). */
export function onStepPage(step: Pick<TourStep, "href">, pathname: string | null): boolean {
  if (step.href === null) return true;
  if (!pathname) return false;
  return step.href.split(/[?#]/)[0] === pathname;
}

/* ── State machine ─────────────────────────────────────────────────────────── */

export type TourState =
  | { status: "idle" }
  | { status: "running"; role: GuideRole; steps: TourStep[]; index: number; direction: 1 | -1 }
  | { status: "finished"; role: GuideRole; outcome: "completed" | "dismissed" };

export type TourEvent =
  | { type: "start"; role: GuideRole; steps: TourStep[] }
  | { type: "next" }
  | { type: "back" }
  | { type: "dismiss" }
  | { type: "anchor_missing"; stepId: string }
  /** Later OPTIONAL steps known to be absent (checked when an earlier step on the same page is found), dropped before
   * they are reached so the "n of N" total never shrinks mid-tour. Current and earlier steps are never pruned. */
  | { type: "prune"; stepIds: string[] }
  | { type: "reset" };

export const IDLE_TOUR: TourState = Object.freeze({ status: "idle" });

export function tourReducer(state: TourState, event: TourEvent): TourState {
  switch (event.type) {
    case "start":
      if (event.steps.length === 0) return IDLE_TOUR;
      return { status: "running", role: event.role, steps: event.steps, index: 0, direction: 1 };
    case "reset":
      return IDLE_TOUR;
  }
  if (state.status !== "running") return state;
  switch (event.type) {
    case "next":
      return state.index >= state.steps.length - 1
        ? { status: "finished", role: state.role, outcome: "completed" }
        : { ...state, index: state.index + 1, direction: 1 };
    case "back":
      return state.index === 0 ? state : { ...state, index: state.index - 1, direction: -1 };
    case "dismiss":
      return { status: "finished", role: state.role, outcome: "dismissed" };
    case "prune": {
      const drop = new Set(event.stepIds);
      const steps = state.steps.filter((s, i) => i <= state.index || !(s.optional && drop.has(s.id)));
      return steps.length === state.steps.length ? state : { ...state, steps };
    }
    case "anchor_missing": {
      // Stale report (the step already changed): ignore.
      if (state.steps[state.index]?.id !== event.stepId) return state;
      // Drop the step so progress ("2 of 5") counts only steps that exist, then continue the same way.
      const steps = state.steps.filter((_, i) => i !== state.index);
      if (steps.length === 0) return { status: "finished", role: state.role, outcome: "completed" };
      if (state.direction === -1) return state.index === 0 ? { ...state, steps, index: 0, direction: 1 } : { ...state, steps, index: state.index - 1 };
      if (state.index >= steps.length) return { status: "finished", role: state.role, outcome: "completed" };
      return { ...state, steps, index: state.index };
    }
  }
}

export function currentStep(state: TourState): TourStep | null {
  return state.status === "running" ? (state.steps[state.index] ?? null) : null;
}

/** "Step 2 of 5" and the live announcement for a step. */
export function stepProgress(state: TourState): { position: number; total: number; label: string } | null {
  if (state.status !== "running") return null;
  const position = state.index + 1;
  const total = state.steps.length;
  return { position, total, label: `${position} of ${total}` };
}

/* ── Placement ─────────────────────────────────────────────────────────────── */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: "below" | "above" | "left" | "right" | "bottom-sheet" | "top-sheet";
}

const GAP = 12;
const EDGE = 12;

const bottom = (r: Rect) => r.top + r.height;
const right = (r: Rect) => r.left + r.width;
const overlaps = (a: Rect, b: Rect) => a.left < right(b) && b.left < right(a) && a.top < bottom(b) && b.top < bottom(a);
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * Where the tour card goes: next to the highlighted element, never covering it or any `avoid` rectangle (the
 * page's primary action, e.g. the wizard's sticky Continue bar), and inside the viewport. Tries below, above,
 * right, left; on a small screen falls back to the top or bottom edge, whichever is clear of the anchor.
 */
export function placeTourCard(anchor: Rect, card: { width: number; height: number }, viewport: { width: number; height: number }, avoid: readonly Rect[] = []): Placement {
  const fits = (r: Rect) => r.top >= EDGE && r.left >= EDGE && bottom(r) <= viewport.height - EDGE && right(r) <= viewport.width - EDGE;
  const clear = (r: Rect) => !overlaps(r, anchor) && avoid.every((a) => !overlaps(r, a));
  const hCentred = clamp(anchor.left + anchor.width / 2 - card.width / 2, EDGE, viewport.width - EDGE - card.width);
  const vCentred = clamp(anchor.top + anchor.height / 2 - card.height / 2, EDGE, viewport.height - EDGE - card.height);
  const candidates: Placement[] = [
    { side: "below", top: bottom(anchor) + GAP, left: hCentred },
    { side: "above", top: anchor.top - GAP - card.height, left: hCentred },
    { side: "right", top: vCentred, left: right(anchor) + GAP },
    { side: "left", top: vCentred, left: anchor.left - GAP - card.width },
  ];
  for (const c of candidates) {
    const r = { top: c.top, left: c.left, width: card.width, height: card.height };
    if (fits(r) && clear(r)) return c;
  }
  // Small screens: pin to the edge away from the element's top (its heading); keep clear of avoid areas when possible.
  const left = clamp((viewport.width - card.width) / 2, EDGE, viewport.width - EDGE - card.width);
  const top: Placement = { side: "top-sheet", top: EDGE, left };
  const bottomSheet: Placement = { side: "bottom-sheet", top: Math.max(EDGE, viewport.height - EDGE - card.height), left };
  // The part of the element people read first is its top (its heading): keep that visible.
  const focus = anchor.top + Math.min(anchor.height, 120) / 2;
  const ordered = focus > viewport.height / 2 ? [top, bottomSheet] : [bottomSheet, top];
  for (const c of ordered) {
    const r = { top: c.top, left: c.left, width: card.width, height: card.height };
    if (clear(r)) return c;
  }
  for (const c of ordered) {
    if (!overlaps({ top: c.top, left: c.left, width: card.width, height: card.height }, anchor)) return c;
  }
  // The element is taller than the screen: overlap is unavoidable; at least keep the primary action clear.
  for (const c of ordered) {
    if (avoid.every((a) => !overlaps({ top: c.top, left: c.left, width: card.width, height: card.height }, a))) return c;
  }
  return ordered[0];
}
