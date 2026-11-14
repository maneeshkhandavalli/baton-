/**
 * DEMO SCENARIO: the six-step journey, its fixed clock and the canonical ("suggested") actions.
 *
 * The demo runs on a fixed scenario clock: every action a visitor takes is stamped with the time
 * of the step it belongs to, never with the visitor's real clock, so dates stay consistent.
 * The canonical actions are what the guided walkthrough suggests, and what "jump to step N"
 * replays to build that step's starting state. They use the same shapes as the real review
 * inputs (lib/contracts/schemas.ts) with point keys instead of ids.
 * Pure data: no React, no I/O.
 */

import type { SupportVerdict } from "@/lib/contracts/enums";

import type { DemoPersonKey } from "./cast";
import type { DemoPointKey } from "./points";

export const DEMO_STEPS = [
  { id: "sources", n: 1, label: "Sources", actor: "kabir" },
  { id: "draft", n: 2, label: "AI draft", actor: "kabir" },
  { id: "review", n: 3, label: "Review", actor: "kabir" },
  { id: "decisions", n: 4, label: "Decisions and tasks", actor: "kabir" },
  { id: "publish", n: 5, label: "Publish", actor: "kabir" },
  { id: "receive", n: 6, label: "Neha's view and Gap Interview", actor: "neha" },
] as const satisfies ReadonlyArray<{ id: string; n: number; label: string; actor: DemoPersonKey }>;

export type DemoStepId = (typeof DEMO_STEPS)[number]["id"];

/** Scenario timeline (UTC ISO; India is UTC+05:30). Times in comments are IST. */
export const DEMO_TIMELINE = {
  /** Last message in any source: Neha's "thanks kabir!" (8 Nov, 10:12). Baton's "evidence as of". */
  evidenceAsOf: "2026-11-08T04:42:00.000Z",
  exportedAt: "2026-11-10T16:00:00.000Z", // 10 Nov 21:30, Kabir exports both chats
  handoverCreatedAt: "2026-11-11T04:35:00.000Z", // 11 Nov 10:05
  sourcesUploadedAt: "2026-11-11T04:42:00.000Z", // 10:12
  consentRecordedAt: "2026-11-11T04:44:00.000Z", // 10:14
  exclusionsRecordedAt: "2026-11-11T04:46:00.000Z", // 10:16
  runStartedAt: "2026-11-11T04:50:00.000Z", // 10:20
  runFinishedAt: "2026-11-11T04:59:00.000Z", // 10:29
  rawDeletedAt: "2026-11-11T04:59:30.000Z", // raw uploads deleted after the parse
  priyaReviewedAt: "2026-11-11T14:30:00.000Z", // 11 Nov 20:00, Priya approves the straightforward points
  kabirReviewStartsAt: "2026-11-12T05:30:00.000Z", // 12 Nov 11:00, the visitor's corrections
  publishedV1At: "2026-11-13T13:00:00.000Z", // 13 Nov 18:30
  nehaOpenedAt: "2026-11-14T03:40:00.000Z", // 14 Nov 09:10
  nehaAcknowledgedV1At: "2026-11-14T03:55:00.000Z", // 09:25
  gapLinkCreatedAt: "2026-11-14T04:30:00.000Z", // 10:00, Kabir sends Ananya a Gap Interview link
  gapAnsweredAt: "2026-11-14T16:10:00.000Z", // 21:40, Ananya answers
  gapAcceptedAt: "2026-11-15T03:45:00.000Z", // 15 Nov 09:15, Kabir accepts the answer
  revisionStartedAt: "2026-11-15T03:47:00.000Z",
  publishedV2At: "2026-11-15T04:00:00.000Z", // 09:30
  nehaAcknowledgedV2At: "2026-11-15T05:10:00.000Z", // 10:40
  /** Kabir's last day; Neha takes over on 1 December. */
  kabirLeavesOn: "2026-11-30",
} as const;

/** The step clock: the time a visitor action in each step is stamped with (plus one minute per action). */
export const DEMO_STEP_CLOCK: Readonly<Record<DemoStepId, string>> = {
  sources: DEMO_TIMELINE.sourcesUploadedAt,
  draft: DEMO_TIMELINE.runStartedAt,
  review: DEMO_TIMELINE.kabirReviewStartsAt,
  decisions: DEMO_TIMELINE.kabirReviewStartsAt,
  publish: DEMO_TIMELINE.publishedV1At,
  receive: DEMO_TIMELINE.nehaOpenedAt,
};

/**
 * Re-verification after an edit. The real product re-checks every quote against the new wording
 * with AI; the demo cannot. For the canonical edits the result is scripted here. For any other
 * edit a visitor makes, the demo keeps the earlier verdicts and labels them "not re-checked in
 * the demo" (see plan.md).
 */
export interface ScriptedReverify {
  /** Index into the point's evidence list → verdict against the new wording. */
  verdicts: Record<number, SupportVerdict>;
  why: Record<number, string>;
}

export type DemoAction =
  | { step: DemoStepId; action: "approve"; point: DemoPointKey; confirmInferred?: true; resolutionNote?: string; asKnownGap?: true }
  | { step: DemoStepId; action: "reject"; point: DemoPointKey; reason: string }
  | { step: DemoStepId; action: "edit"; point: DemoPointKey; title: string; statement: string; attributes: Record<string, unknown>; editReason: string; reverify: ScriptedReverify }
  | { step: DemoStepId; action: "confirm_inferred"; point: DemoPointKey; note?: string }
  | { step: DemoStepId; action: "resolve_conflict"; point: DemoPointKey; resolutionNote: string }
  | { step: DemoStepId; action: "exclude_evidence"; point: DemoPointKey; evidenceIndex: number; reason: string }
  | { step: DemoStepId; action: "publish"; summary: string }
  | { step: DemoStepId; action: "acknowledge"; as: "neha" }
  | { step: DemoStepId; action: "create_gap_link"; questions: number[]; sentTo: DemoPersonKey }
  | { step: DemoStepId; action: "submit_gap_answer"; question: number; answererLabel: string; text: string }
  | { step: DemoStepId; action: "accept_gap_answer"; question: number }
  | { step: DemoStepId; action: "start_revision" };

/** The suggested path, in order. "Jump to step N" replays every action of the steps before N. */
export const DEMO_CANONICAL_ACTIONS: readonly DemoAction[] = [
  // Step 3: Kabir's corrections (Priya already approved the straightforward points).
  {
    step: "review",
    action: "edit",
    point: "workshop_fee",
    title: "Workshops are free for everyone",
    statement: "Workshops are free for everyone, members and non-members. The ₹100 non-member fee was dropped at the leads call in September 2026.",
    attributes: { decidedAt: "2026-09-18", decidedByLabel: "Leads call", rationale: null, alternativesConsidered: ["₹100 per workshop for non-members"] },
    editReason: "The fee was dropped in September; the point described the old rule.",
    reverify: {
      verdicts: { 0: "contradicts", 1: "supports" },
      why: { 0: "Describes the old ₹100 fee, which the new wording says was dropped.", 1: "States that workshops became free for everyone." },
    },
  },
  { step: "review", action: "resolve_conflict", point: "workshop_fee", resolutionNote: "The leads call on 18 September replaced the 4 August fee. Workshops are free." },
  { step: "review", action: "approve", point: "workshop_fee" },
  { step: "review", action: "approve", point: "weekly_meeting", confirmInferred: true },
  { step: "review", action: "reject", point: "tshirts", reason: "True, but a one-off order. Neha doesn't need it." },
  { step: "review", action: "exclude_evidence", point: "reimbursements", evidenceIndex: 1, reason: "A member's personal number and payment. It adds nothing to the rule." },
  { step: "review", action: "approve", point: "reimbursements" },
  {
    step: "review",
    action: "edit",
    point: "domain_renewal",
    title: "Renew the club domain",
    statement: "Renew codecell.example.org before 12 December. Kabir moves the billing from his personal card to the club card before he leaves on 30 November.",
    attributes: { assigneeLabel: "Neha Kulkarni", dueDate: "2026-12-12", progressNote: "Kabir moves billing to the club card before 30 November." },
    editReason: "Kabir leaves on 30 November, so the renewal falls to Neha.",
    reverify: {
      verdicts: { 0: "supports", 1: "supports" },
      why: { 0: "States the renewal date and that billing must move to the club card.", 1: "The notes give the same renewal date." },
    },
  },
  { step: "review", action: "approve", point: "domain_renewal" },
  { step: "review", action: "approve", point: "discord_admin", asKnownGap: true },
  { step: "review", action: "approve", point: "instagram_account", asKnownGap: true },
  // Step 4 has no required actions: it shows the decisions and tasks that are now backed and approved.
  // Step 5: publish v1.
  {
    step: "publish",
    action: "publish",
    summary:
      "Neha, this is everything I know about the technical lead role. The urgent items are the domain renewal on 12 December and the auditorium form before the winter break. The judging portal deploy is the biggest risk, so we'll do the next one together before 30 November.",
  },
  // Step 6: Neha reads and acknowledges; the Gap Interview closes one of the gaps; v2.
  { step: "receive", action: "acknowledge", as: "neha" },
  { step: "receive", action: "create_gap_link", questions: [1, 2], sentTo: "ananya" },
  { step: "receive", action: "submit_gap_answer", question: 1, answererLabel: "Ananya Iyer", text: "I set the server up in 2025 and I'm its only admin. Kabir has moderator rights. I'll make Neha an admin on 1 December." },
  { step: "receive", action: "accept_gap_answer", question: 1 },
  { step: "receive", action: "start_revision" },
  {
    step: "receive",
    action: "edit",
    point: "discord_admin",
    title: "Ananya runs the Discord server",
    statement: "Ananya Iyer is the only admin of the CodeCell Discord server, and Kabir is a moderator. Ananya makes Neha an admin on 1 December.",
    attributes: { responsibility: "Discord server administration", ownerLabel: "Ananya Iyer", since: "2025" },
    editReason: "Filled in from Ananya's Gap Interview answer.",
    // Index 0 is the testimony evidence that accepting the answer added.
    reverify: { verdicts: { 0: "supports" }, why: { 0: "Ananya says she is the only admin and names the moderator." } },
  },
  { step: "receive", action: "approve", point: "discord_admin" },
  { step: "receive", action: "publish", summary: "Version 2 adds who runs the Discord server, from Ananya's Gap Interview answer." },
  { step: "receive", action: "acknowledge", as: "neha" },
];
