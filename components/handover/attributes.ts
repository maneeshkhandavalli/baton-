import type { PointCategory } from "@/lib/contracts/enums";
import type { PointAttributes } from "@/lib/contracts/schemas";

import { formatDate } from "./format";

const LABELS: Record<string, string> = {
  decidedAt: "Decided",
  decidedByLabel: "Decided by",
  rationale: "Why",
  alternativesConsidered: "Alternatives considered",
  responsibility: "Responsibility",
  ownerLabel: "Owner",
  since: "Since",
  assigneeLabel: "Assignee",
  dueDate: "Due",
  progressNote: "Progress",
  blockingWhat: "Blocking",
  unblockCondition: "Unblocked when",
  likelihood: "Likelihood",
  impact: "Impact",
  mitigation: "Mitigation",
  dependsOnLabel: "Depends on",
  dependencyType: "Type",
  frequency: "How often",
  knownWorkaround: "Workaround",
  firstSeenAt: "First seen",
  nameLabel: "Name",
  organisation: "Organisation",
  roleDescription: "Role",
  preferredChannel: "Preferred channel",
  directContact: "Direct contact",
  actorLabel: "Who",
  byWhen: "By when",
  system: "System",
  holderLabel: "Held by",
  accessLocation: "Where access lives",
  recoveryNote: "Recovery",
};

const DATE_KEYS = new Set(["decidedAt", "dueDate"]);
const ENUM_VALUES: Record<string, Record<string, string>> = {
  likelihood: { low: "Low", medium: "Medium", high: "High" },
  impact: { low: "Low", medium: "Medium", high: "High" },
  dependencyType: { person: "Person", organisation: "Organisation", system: "System", event: "Event" },
  preferredChannel: { whatsapp: "WhatsApp", email: "Email", phone: "Phone", in_person: "In person", other: "Other" },
};

export function attributeLabel(key: string) {
  return LABELS[key] ?? key;
}

export function enumOptions(key: string) {
  return ENUM_VALUES[key] ?? null;
}

/** Human-readable [label, value] rows for a point's category attributes, skipping empty values. */
export function attributeRows(_category: PointCategory, attributes: PointAttributes): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(attributes as Record<string, unknown>)) {
    if (raw === null || raw === undefined || raw === "") continue;
    let value: string;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      value = raw.join(", ");
    } else if (typeof raw === "object") {
      const dc = raw as { channel?: string; value?: string };
      value = dc.value ? `${dc.value} (${dc.channel})` : "";
      if (!value) continue;
    } else if (DATE_KEYS.has(key) && typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      value = formatDate(raw);
    } else {
      value = ENUM_VALUES[key]?.[String(raw)] ?? String(raw);
    }
    rows.push([attributeLabel(key), value]);
  }
  return rows;
}
