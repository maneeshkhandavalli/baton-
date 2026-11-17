/**
 * D21 "expected knowledge" checklist, DRAFT v1 (main workspace drafts it; to be reviewed with real club
 * handovers). W0 decision I2.6: an uncovered item becomes a category-level system gap question
 * (`pointId: null`), not a `missing` point with fabricated AI provenance.
 *
 * Priority follows §10.10: owner, account_access, open_task and blocker are `required`, everything else
 * `optional`. Questions are generic (no source content), so they are asked at `everyone`.
 */

import type { GapPriority, PointCategory } from "../contracts/enums";

export const CHECKLIST_VERSION = "checklist@1";

export interface ChecklistItem {
  key: string;
  category: PointCategory;
  question: string;
  /**
   * R3 Task 04: the subject the question itself names, used as the category's REQUIRED attribute when an answer to
   * this question becomes a point (owner.responsibility, account_access.system). Only where the question text
   * names it: a contact's NAME is never derivable from a question, so `faculty_contact` has none. Mirrored in SQL by
   * `_checklist_point_detail` (migration 20261117400100); a test keeps both in step.
   */
  pointDetail?: string;
}

export const REQUIRED_GAP_CATEGORIES: ReadonlySet<PointCategory> = new Set(["owner", "account_access", "open_task", "blocker"]);

export function gapPriority(category: PointCategory | null): GapPriority {
  return category !== null && REQUIRED_GAP_CATEGORIES.has(category) ? "required" : "optional";
}

export const EXPECTED_KNOWLEDGE_CHECKLIST: readonly ChecklistItem[] = [
  { key: "bank_or_upi_holder", category: "account_access", question: "Who holds the bank or UPI account, and how is access handed over?", pointDetail: "Bank or UPI account" },
  { key: "shared_logins", category: "account_access", question: "Where are shared logins (email, social media, drive) kept, and who can recover them?", pointDetail: "Shared logins (email, social media, drive)" },
  { key: "budget_owner", category: "owner", question: "Who is responsible for the budget and reimbursements?", pointDetail: "Budget and reimbursements" },
  { key: "faculty_contact", category: "contact", question: "Who is the faculty or administration contact, and how are they best reached?" },
  { key: "open_tasks", category: "open_task", question: "Which tasks are still open, and who should pick them up?" },
  { key: "current_blockers", category: "blocker", question: "Is anything blocked right now, and what would unblock it?" },
  { key: "upcoming_actions", category: "next_action", question: "What are the next events or deadlines, and who is acting on them?" },
  { key: "outside_dependencies", category: "dependency", question: "Which outside groups, vendors or systems does the team depend on?" },
  { key: "recurring_problems", category: "recurring_problem", question: "Which problems keep coming back, and what is the usual workaround?" },
];

/** R3 Task 04: the attribute a point of this category cannot exist without; null when none is required. */
export const GAP_POINT_REQUIRED_FIELD: Readonly<Partial<Record<PointCategory, "responsibility" | "nameLabel" | "system">>> = Object.freeze({
  owner: "responsibility",
  contact: "nameLabel",
  account_access: "system",
});

/** The checklist question's own subject for that required attribute, or null (exact category + text match). */
export function checklistPointDetail(category: PointCategory | null, question: string): string | null {
  if (category === null) return null;
  return EXPECTED_KNOWLEDGE_CHECKLIST.find((i) => i.category === category && i.question === question)?.pointDetail ?? null;
}
