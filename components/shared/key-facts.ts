/**
 * The two or three facts that make a point scannable — who owns it, by when, what state it is in —
 * pulled out of the category attributes so review and the published handover can show them as a
 * strip above the statement (docs/design/design-system.md → Decisions & action items).
 * Pure and React-free (components/shared/__tests__/key-facts.test.ts).
 */

import { formatDate } from "@/components/handover/format";
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

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * A real calendar day in `YYYY-MM-DD` form, or null. Round-trips through Date.UTC so values the
 * regex accepts but the calendar doesn't ("2026-13-45", "2026-02-31") are rejected (QA-R3-12).
 */
export function validIsoDay(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? m[0] : null;
}

/** Formats a valid day; anything else (including an unexpected Intl error) is shown as written. Never throws. */
export function formatDayOrRaw(v: unknown): string | null {
  const raw = text(v);
  const iso = validIsoDay(v);
  if (!iso) return raw;
  try {
    return formatDate(iso);
  } catch {
    return raw;
  }
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
      push("date", "Decided", formatDayOrRaw(a.decidedAt));
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
      const due = validIsoDay(a.dueDate);
      const dueText = formatDayOrRaw(a.dueDate);
      if (due) push("date", "Due", dueText, today && due < today ? "danger" : "neutral");
      else push("date", "Due", dueText ?? "No date", dueText ? "warning" : "neutral");
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
