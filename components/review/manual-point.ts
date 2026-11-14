/**
 * Pure helpers for the review workspace's "Add a point" dialog (createManualPoint, §11.3).
 * A reviewer adds knowledge the AI missed; the server masks every free-text field and enforces the
 * same rules again (createManualPointInput, create_manual_point: in_review only, review roles only).
 */
import { POINT_CATEGORIES, type AccessLevel, type PointCategory } from "@/lib/contracts/enums";
import { createManualPointInput, type CreateManualPointInput } from "@/lib/contracts/schemas";

export type ManualFieldKind = "text" | "date" | "enum" | "list";
export interface ManualField {
  key: string;
  kind: ManualFieldKind;
  required?: boolean;
}

/**
 * Editable attributes per category, mirroring lib/contracts/schemas.ts (§3.1). `contact.directContact`
 * is deliberately absent: a typed-in phone/email needs leads-only access and its own validation, and is
 * not offered here (the edit dialog does not offer it either).
 */
export const MANUAL_FIELDS: Record<PointCategory, readonly ManualField[]> = {
  decision: [
    { key: "decidedAt", kind: "text" },
    { key: "decidedByLabel", kind: "text" },
    { key: "rationale", kind: "text" },
    { key: "alternativesConsidered", kind: "list" },
  ],
  owner: [
    { key: "responsibility", kind: "text", required: true },
    { key: "ownerLabel", kind: "text" },
    { key: "since", kind: "text" },
  ],
  open_task: [
    { key: "assigneeLabel", kind: "text" },
    { key: "dueDate", kind: "date" },
    { key: "progressNote", kind: "text" },
  ],
  blocker: [
    { key: "blockingWhat", kind: "text" },
    { key: "unblockCondition", kind: "text" },
  ],
  risk: [
    { key: "likelihood", kind: "enum" },
    { key: "impact", kind: "enum" },
    { key: "mitigation", kind: "text" },
  ],
  dependency: [
    { key: "dependsOnLabel", kind: "text" },
    { key: "dependencyType", kind: "enum" },
  ],
  recurring_problem: [
    { key: "frequency", kind: "text" },
    { key: "knownWorkaround", kind: "text" },
    { key: "firstSeenAt", kind: "text" },
  ],
  contact: [
    { key: "nameLabel", kind: "text", required: true },
    { key: "organisation", kind: "text" },
    { key: "roleDescription", kind: "text" },
    { key: "preferredChannel", kind: "enum" },
  ],
  next_action: [
    { key: "actorLabel", kind: "text" },
    { key: "byWhen", kind: "text" },
  ],
  account_access: [
    { key: "system", kind: "text", required: true },
    { key: "holderLabel", kind: "text" },
    { key: "accessLocation", kind: "text" },
    { key: "recoveryNote", kind: "text" },
  ],
};

/** Raw form values as the dialog holds them (strings; lists comma-separated). */
export interface ManualPointForm {
  category: PointCategory;
  title: string;
  statement: string;
  fields: Record<string, string>;
  /** The reviewer's own account of how they know this; stored as testimony evidence. */
  testimony: string;
  /** null keeps the default visibility. */
  accessOverride: AccessLevel | null;
}

export function blankManualForm(category: PointCategory = "decision"): ManualPointForm {
  return { category, title: "", statement: "", fields: {}, testimony: "", accessOverride: null };
}

export function isPointCategory(v: string): v is PointCategory {
  return (POINT_CATEGORIES as readonly string[]).includes(v);
}

/** Category attributes from the form: blank text → null, lists split on commas, required kept as typed. */
export function attributesFor(form: ManualPointForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of MANUAL_FIELDS[form.category]) {
    const raw = (form.fields[f.key] ?? "").trim();
    if (f.kind === "list") out[f.key] = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    else if (f.required) out[f.key] = raw;
    else out[f.key] = raw === "" ? null : raw;
  }
  if (form.category === "contact") out.directContact = null;
  return out;
}

export type BuildResult = { ok: true; input: CreateManualPointInput } | { ok: false; fieldErrors: Record<string, string[]> };

/**
 * Builds and validates the createManualPoint input on the client with the shared schema, so the
 * dialog can show field errors before the round trip. Error keys: `title`, `statement`,
 * `testimony`, and `attr.<key>` for category attributes.
 */
export function buildManualPointInput(handoverId: string, form: ManualPointForm): BuildResult {
  const testimony = form.testimony.trim();
  const candidate = {
    handoverId,
    category: form.category,
    title: form.title.trim(),
    statement: form.statement.trim(),
    attributes: attributesFor(form),
    ...(form.accessOverride ? { accessOverride: form.accessOverride } : {}),
    ...(testimony ? { testimony: { text: testimony } } : {}),
  } as CreateManualPointInput;
  const parsed = createManualPointInput.safeParse(candidate);
  if (parsed.success) return { ok: true, input: candidate };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const [head, second] = issue.path.map(String);
    const key = head === "attributes" && second ? `attr.${second}` : head === "testimony" ? "testimony" : (head ?? "form");
    (fieldErrors[key] ??= []).push(messageFor(key, issue.code));
  }
  return { ok: false, fieldErrors };
}

function messageFor(key: string, code: string): string {
  if (key === "title") return "Add a short title (up to 120 characters).";
  if (key === "statement") return "Describe the point (up to 1,000 characters).";
  if (key === "testimony") return "Keep it under 4,000 characters.";
  if (key.startsWith("attr.")) return code === "too_small" ? "Required for this kind of point." : "Check this value.";
  return "Check the form.";
}
