/**
 * The two or three facts that make a point scannable — who owns it, by when, what state it is in —
 * pulled out of the category attributes so review and the published handover can show them as a
 * strip above the statement (docs/design/design-system.md → Decisions & action items).
 * Pure and React-free (components/shared/__tests__/key-facts.test.ts).
 */

import type { PointCategory } from "@/lib/contracts/enums";

export type FactKind = "person" | "date" | "status" | "info";
export type FactTone = "neutral" | "warning" | "danger";

export interface KeyFact {
  kind: FactKind;
  label: string;
  value: string;
  tone: FactTone;
}

/** Categories that are things someone must DO; missing owner / date is called out. */
export const ACTION_CATEGORIES: readonly PointCategory[] = ["open_task", "next_action", "blocker"];

const TZ_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isoDay(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function fmtDay(iso: string): string {
  return TZ_DATE.format(new Date(`${iso}T00:00:00+05:30`));
}

/**
 * Key facts for a point. `today` (YYYY-MM-DD) marks overdue due dates; omit it to never flag
 * (keeps server and client renders identical when the caller has no stable "today").
 */
export function keyFacts(category: PointCategory, attributes: unknown, today?: string): KeyFact[] {
  const a = (attributes ?? {}) as Record<string, unknown>;
  const facts: KeyFact[] = [];
  const push = (kind: FactKind, label: string, value: string | null, tone: FactTone = "neutral") => {
    if (value) facts.push({ kind, label, value, tone });
  };

  switch (category) {
    case "decision": {
      push("date", "Decided", isoDay(a.decidedAt) ? fmtDay(a.decidedAt as string) : text(a.decidedAt));
      push("person", "By", text(a.decidedByLabel));
      break;
    }
    case "owner": {
      push("person", "Owner", text(a.ownerLabel) ?? "Not named", text(a.ownerLabel) ? "neutral" : "warning");
      push("date", "Since", text(a.since));
      break;
    }
    case "open_task": {
      push("person", "Assignee", text(a.assigneeLabel) ?? "Unassigned", text(a.assigneeLabel) ? "neutral" : "warning");
      const due = isoDay(a.dueDate);
      if (due) push("date", "Due", fmtDay(due), today && due < today ? "danger" : "neutral");
      else push("date", "Due", "No date");
      push("status", "Status", text(a.progressNote) ? "In progress" : "Open");
      break;
    }
    case "next_action": {
      push("person", "Who", text(a.actorLabel) ?? "Unassigned", text(a.actorLabel) ? "neutral" : "warning");
      push("date", "By when", text(a.byWhen) ?? "No date");
      break;
    }
    case "blocker": {
      push("status", "Blocking", text(a.blockingWhat));
      push("info", "Unblocked when", text(a.unblockCondition));
      break;
    }
    case "account_access": {
      push("info", "System", text(a.system));
      push("person", "Held by", text(a.holderLabel) ?? "Not named", text(a.holderLabel) ? "neutral" : "warning");
      break;
    }
    case "contact": {
      push("person", "Contact", text(a.nameLabel));
      push("info", "Organisation", text(a.organisation));
      break;
    }
    case "risk": {
      const level = (v: unknown) => (v === "high" ? "High" : v === "medium" ? "Medium" : v === "low" ? "Low" : null);
      push("status", "Impact", level(a.impact), a.impact === "high" ? "danger" : "neutral");
      push("status", "Likelihood", level(a.likelihood), a.likelihood === "high" ? "warning" : "neutral");
      break;
    }
    case "dependency": {
      push("info", "Depends on", text(a.dependsOnLabel));
      break;
    }
    case "recurring_problem": {
      push("info", "How often", text(a.frequency));
      break;
    }
  }
  return facts;
}

/** Attribute keys already shown as key facts, so detail lists don't repeat them. */
export const KEY_FACT_LABELS = new Set(["Decided", "Decided by", "Owner", "Assignee", "Due", "Who", "By when", "Blocking", "Held by", "System", "Name", "Organisation", "Impact", "Likelihood", "Depends on", "How often", "Since", "Unblocked when"]);
