/**
 * The interactive demo's step → screen mapping and the plain-language guide for each step (R3 Task 06, frozen
 * contract §2). Pure and React-free (components/demo/__tests__/demo-guide.test.ts).
 *
 * A judge must understand each step without a walkthrough: every step says what they are looking at, one thing to
 * try, and why it matters. The framing line is shown on every demo screen: nothing in the demo is saved or sent.
 */

import type { PointCategory } from "@/lib/contracts/enums";
import { DEMO_STEPS, type DemoStepId } from "@/lib/demo/scenario/journey";

export const DEMO_FRAMING = "Demo · nothing is saved or sent";
export const DEMO_FRAMING_DETAIL =
  "Everyone and everything here is fictional. Your changes live only in this browser tab: no account, no database, no email and no AI. Reset whenever you like.";

/** sessionStorage key of the visitor's demo session (contract §2.3). */
export const DEMO_STORAGE_KEY = "baton.demo.v1";

export type DemoScreen = "sources" | "draft" | "review" | "decisions" | "publish" | "receive";

/** Whose eyes the step is seen through (contract DemoViewer). */
export type DemoStepViewer = "priya" | "neha";

export interface DemoStepGuide {
  screen: DemoScreen;
  viewer: DemoStepViewer;
  /** "Priya, the outgoing lead" */
  as: string;
  title: string;
  what: string;
  tryThis: string;
  why: string;
}

export const DEMO_STEP_GUIDE: Readonly<Record<DemoStepId, DemoStepGuide>> = {
  sources: {
    screen: "sources",
    viewer: "priya",
    as: "Priya, the outgoing technical lead",
    title: "The record goes in",
    what: "Priya added the exports of two WhatsApp groups and the club's infrastructure notes. Baton masked phone numbers and other personal details before storing anything, and deleted the raw uploads once they were read.",
    tryThis: "Look at what was masked in each source and when its consent was recorded.",
    why: "Nothing reaches the review until consent is recorded, and personal details never leave the upload unmasked.",
  },
  draft: {
    screen: "draft",
    viewer: "priya",
    as: "Priya, the outgoing technical lead",
    title: "Baton drafts the handover",
    what: "Baton turned the record into points: decisions, owners, open tasks, risks. Each one cites the exact message it rests on, and its status says how well that holds up.",
    tryThis: "Open a point marked Conflicting or Missing and read the quotes behind it.",
    why: "Every point can be checked against its source. The draft is a starting point, not the truth: people decide next.",
  },
  review: {
    screen: "review",
    viewer: "priya",
    as: "Priya, the outgoing technical lead",
    title: "People check every point",
    what: "Priya approves, edits or rejects each point. Conflicts need a note on what is true now; inferred points need confirming.",
    tryThis: "Approve a sourced point, then resolve the workshop-fee conflict with a short note.",
    why: "Only a person's decision counts. The AI's judgement is shown, but it never approves anything on its own.",
  },
  decisions: {
    screen: "decisions",
    viewer: "priya",
    as: "Priya, the outgoing technical lead",
    title: "Decisions and tasks",
    what: "The decisions, open tasks and next actions Neha will inherit, each with its owner, due date and evidence.",
    tryThis: "Check who owns the domain renewal and when it is due.",
    why: "This is what the next person acts on in their first week, so it has to be right.",
  },
  publish: {
    screen: "publish",
    viewer: "priya",
    as: "Priya, the outgoing technical lead",
    title: "Publish when it's ready",
    what: "Readiness lists anything still blocking: points to decide, gaps to answer, conflicts to settle. Publishing is possible only when nothing blocks it.",
    tryThis: "Read the readiness list, then publish the handover.",
    why: "A handover is never published with undecided points or unsettled conflicts.",
  },
  receive: {
    screen: "receive",
    viewer: "neha",
    as: "Neha, the incoming lead",
    title: "Neha receives it",
    what: "Neha reads the published handover and acknowledges it. Questions nobody could answer go to the Gap Interview, where someone who knows answers them and Priya accepts the answer. When a source is updated later, Baton lists what changed for Priya to decide.",
    tryThis: "Acknowledge as Neha, answer and accept a Gap Interview question, then decide one source change.",
    why: "Gaps are named, not hidden, and nothing changes in a published handover without a person's decision.",
  },
};

export const DEMO_STEP_IDS: readonly DemoStepId[] = DEMO_STEPS.map((s) => s.id);

/** `?step=` value → a known step, or null. */
export function parseStepParam(value: unknown): DemoStepId | null {
  return typeof value === "string" && (DEMO_STEP_IDS as readonly string[]).includes(value) ? (value as DemoStepId) : null;
}

/**
 * The step a demo link opens: none asked for (null, resume this tab's demo), a known step, or the FIRST step for an
 * unknown `?step=` value (judge break test: `?step=bogus` resumed the last-seen step instead).
 */
export function initialStepFromQuery(value: unknown): DemoStepId | null {
  if (value === undefined) return null;
  return parseStepParam(value) ?? DEMO_STEP_IDS[0];
}

export function stepNumber(step: DemoStepId): number {
  return DEMO_STEP_IDS.indexOf(step) + 1;
}

export function adjacentStep(step: DemoStepId, delta: -1 | 1): DemoStepId | null {
  return DEMO_STEP_IDS[DEMO_STEP_IDS.indexOf(step) + delta] ?? null;
}

/** The "decisions and tasks" screen: what the next person acts on. */
export const DECISION_CATEGORIES: ReadonlySet<PointCategory> = new Set<PointCategory>(["decision", "open_task", "next_action", "owner"]);
