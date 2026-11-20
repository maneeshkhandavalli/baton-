/**
 * The review Edit dialog's fields. Stored text carries `[PERSON_n]` placeholders, while the card shows the
 * name this viewer may see (PeopleProvider) or "Person n". The dialog pre-fills with that same shown text,
 * and a field the reviewer did not change is sent back exactly as stored, so saving never writes the
 * shown text (or a different value) in place of an untouched placeholder.
 *
 * A field the reviewer did change is sent with every shown name, and every "Person n", turned back into its
 * `[PERSON_n]` placeholder (audit 21 Nov, blocker: a one-word fix next to a name used to store the name in clear,
 * and it reached the published snapshot and the AI). A name the reviewer types that is not in the viewer's names
 * map (someone new) is stored as typed: edits are not otherwise re-pseudonymised (documented).
 */

import { resolvePersonTokens } from "@/components/shared/mask-tokens";
import type { PointDetail } from "@/lib/contracts/dto";

export interface EditDraft {
  title: string;
  statement: string;
  attributes: Record<string, unknown>;
}

type EditablePoint = Pick<PointDetail, "title" | "statement" | "attributes">;

function resolveValue(value: unknown, names: ReadonlyMap<number, string>): unknown {
  if (typeof value === "string") return resolvePersonTokens(value, names);
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? resolvePersonTokens(v, names) : v));
  return value;
}

/** The fields as the viewer sees them on the card. */
export function editDraftFor(point: EditablePoint, names: ReadonlyMap<number, string>): EditDraft {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(point.attributes as Record<string, unknown>)) attributes[key] = resolveValue(value, names);
  return { title: resolvePersonTokens(point.title, names), statement: resolvePersonTokens(point.statement, names), attributes };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return (a ?? null) === (b ?? null);
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escapeRegExp = (v: string) => v.replace(REGEX_SPECIAL, (c) => `\\${c}`);

/**
 * Turns the names this viewer was shown (and "Person n") back into `[PERSON_n]`. Whole words only,
 * case-insensitive, longest name first so "Meera Iyer" wins over "Meera". Existing placeholders are left alone.
 */
export function retokenizePeople(text: string, names: ReadonlyMap<number, string>): string {
  let out = text.replace(/(?<![\p{L}\p{N}])Person (\d{1,4})(?![\p{L}\p{N}])/giu, (_m, n: string) => `[PERSON_${Number(n)}]`);
  const entries = [...names.entries()]
    .map(([ordinal, name]) => [ordinal, name.trim()] as const)
    .filter(([, name]) => name.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [ordinal, name] of entries) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_\\[])${escapeRegExp(name)}(?![\\p{L}\\p{N}_\\]])`, "giu"), `[PERSON_${ordinal}]`);
  }
  return out;
}

function retokenizeValue(value: unknown, names: ReadonlyMap<number, string>): unknown {
  if (typeof value === "string") return retokenizePeople(value, names);
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? retokenizePeople(v, names) : v));
  return value;
}

/**
 * The values to save: each field the reviewer left as pre-filled (`initial`) goes back as stored on the
 * point; each changed field goes as typed (title and statement trimmed) with shown names turned back into
 * placeholders.
 */
export function editedValues(point: EditablePoint, initial: EditDraft, current: EditDraft, names: ReadonlyMap<number, string>): EditDraft {
  const stored = point.attributes as Record<string, unknown>;
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current.attributes)) {
    attributes[key] = key in stored && sameValue(value, initial.attributes[key]) ? stored[key] : retokenizeValue(value, names);
  }
  return {
    title: sameValue(current.title, initial.title) ? point.title.trim() : retokenizePeople(current.title.trim(), names),
    statement: sameValue(current.statement, initial.statement) ? point.statement.trim() : retokenizePeople(current.statement.trim(), names),
    attributes,
  };
}
