import type { PublishedHandover } from "@/lib/contracts/dto";
import type { PointAttributesFor } from "@/lib/contracts/schemas";

import { formatDate } from "@/components/handover/format";

export interface ChecklistItem {
  id: string;
  title: string;
  detail: string | null;
  pointId: string;
}

export interface ChecklistDay {
  label: string;
  items: ChecklistItem[];
}

/**
 * Derives a "First 7 days" checklist from the published points. It is a UI view only: there is no
 * checklist entity in the contracts, so completion is kept per viewer in browser storage.
 */
export function buildFirstWeek(handover: PublishedHandover): ChecklistDay[] {
  const all = handover.sections.flatMap((s) => s.points.map((p) => ({ ...p, category: s.category })));
  const facts = all.filter((p) => !p.content.isKnownGap);
  const day1: ChecklistItem[] = [];
  const days23: ChecklistItem[] = [];
  const days47: ChecklistItem[] = [];

  for (const p of facts) {
    const c = p.content;
    switch (p.category) {
      case "account_access": {
        const a = c.attributes as PointAttributesFor<"account_access">;
        day1.push({ id: `${p.id}:access`, pointId: p.id, title: `Get access to ${a.system}`, detail: [a.holderLabel && `Held by ${a.holderLabel}`, a.accessLocation].filter(Boolean).join(" · ") || null });
        break;
      }
      case "contact": {
        const a = c.attributes as PointAttributesFor<"contact">;
        days23.push({ id: `${p.id}:contact`, pointId: p.id, title: `Introduce yourself to ${a.nameLabel}`, detail: [a.roleDescription, a.organisation].filter(Boolean).join(", ") || null });
        break;
      }
      case "blocker":
        day1.push({ id: `${p.id}:blocker`, pointId: p.id, title: `Check on: ${c.title}`, detail: (c.attributes as PointAttributesFor<"blocker">).unblockCondition });
        break;
      case "open_task": {
        const a = c.attributes as PointAttributesFor<"open_task">;
        (a.dueDate ? days23 : days47).push({ id: `${p.id}:task`, pointId: p.id, title: c.title, detail: a.dueDate ? `Due ${formatDate(a.dueDate)}` : a.progressNote });
        break;
      }
      case "next_action":
        days23.push({ id: `${p.id}:next`, pointId: p.id, title: c.title, detail: (c.attributes as PointAttributesFor<"next_action">).byWhen });
        break;
      case "risk": {
        const a = c.attributes as PointAttributesFor<"risk">;
        if (a.impact === "high" || a.likelihood === "high") days47.push({ id: `${p.id}:risk`, pointId: p.id, title: `Plan for: ${c.title}`, detail: a.mitigation });
        break;
      }
    }
  }
  for (const p of all.filter((x) => x.content.isKnownGap)) {
    days47.push({ id: `${p.id}:gap`, pointId: p.id, title: `Find out: ${p.content.title.replace(/\?$/, "")}`, detail: "Nobody has answered this yet." });
  }

  return [
    { label: "Day 1", items: day1 },
    { label: "Days 2–3", items: days23 },
    { label: "Days 4–7", items: days47 },
  ].filter((d) => d.items.length > 0);
}
