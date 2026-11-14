/**
 * PROTOTYPE (lib/prototype/flags.ts): turns a CodeCell sample point into the "Add a point" form, and decides
 * whether the form holds the user's own writing (which must never be replaced silently). Pure, so it is
 * unit-tested; the sample content itself is only loaded on demand (lib/prototype/sample-data/codecell.ts).
 */
import type { PointCategory } from "@/lib/contracts/enums";
import type { SamplePoint } from "@/lib/prototype/sample-data/codecell";

import { blankManualForm, MANUAL_FIELDS, type ManualPointForm } from "./manual-point";

/**
 * The form for a category's sample. Only attributes the category's editor offers (MANUAL_FIELDS) are copied,
 * so a sample can never introduce a field the schema does not allow. Testimony stays empty on purpose: it is
 * credited to the signed-in user as their own account, so it must be theirs.
 */
export function sampleForm(category: PointCategory, sample: SamplePoint): ManualPointForm {
  const allowed = new Set(MANUAL_FIELDS[category].map((f) => f.key));
  const fields = Object.fromEntries(Object.entries(sample.fields).filter(([k]) => allowed.has(k)));
  return { ...blankManualForm(category), title: sample.title, statement: sample.statement, fields };
}

/** Anything typed into the form (category and visibility choices alone do not count). */
export function hasContent(form: ManualPointForm): boolean {
  return [form.title, form.statement, form.testimony, ...Object.values(form.fields)].some((v) => v.trim() !== "");
}

/** Same text content (category, title, statement, testimony and attribute values). */
export function sameContent(a: ManualPointForm, b: ManualPointForm): boolean {
  if (a.category !== b.category || a.title !== b.title || a.statement !== b.statement || a.testimony !== b.testimony) return false;
  const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  return [...keys].every((k) => (a.fields[k] ?? "") === (b.fields[k] ?? ""));
}

/**
 * True when filling the sample would replace the user's own writing: the form has content and it is not an
 * untouched copy of the sample that was last filled in.
 */
export function wouldOverwriteUserContent(form: ManualPointForm, lastFilledSample: ManualPointForm | null): boolean {
  if (!hasContent(form)) return false;
  return !(lastFilledSample && sameContent(form, lastFilledSample));
}
