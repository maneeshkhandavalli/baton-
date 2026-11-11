/**
 * The one masking helper for user-entered text (§12.1, I3 amendment 3, QA-H1).
 *
 * lib/db/mutations requires every persisted free-text field to be masked BEFORE the call. Each action
 * creates one InputMasker per request, so the same value gets the same token across the fields of one
 * submission ("send to [UPI_1]" … "[UPI_1] received"). The value-to-token map lives only in memory for
 * that request and is never logged.
 *
 * Masking can change a string's length, so callers re-validate the masked values with the same Zod schema
 * (and attributes with `parsePointAttributes`) before calling the database.
 */

import { createMasker } from "../../privacy/mask";

/**
 * Attribute keys that are never masked:
 *  - `directContact`: the one masking exception, typed in by a review role and validated as a single phone
 *    number or email, stored at leads_only or stricter (D5, §12.1);
 *  - `dueDate`: an ISO date (`YYYY-MM-DD`), not free text, which a digit-run detector must not corrupt.
 */
export const UNMASKED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(["directContact", "dueDate"]);

export interface InputMasker {
  text(value: string): string;
  optional(value: string | undefined): string | undefined;
  nullable(value: string | null | undefined): string | null | undefined;
  /** Masks every string inside an attributes-like object, except UNMASKED_ATTRIBUTE_KEYS. */
  attributes(value: Record<string, unknown>): Record<string, unknown>;
}

export function createInputMasker(): InputMasker {
  const masker = createMasker();
  const text = (value: string) => masker.mask(value, "user_input").text;

  const deep = (value: unknown): unknown => {
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(deep);
    if (value !== null && typeof value === "object") return maskObject(value as Record<string, unknown>);
    return value;
  };

  function maskObject(value: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = UNMASKED_ATTRIBUTE_KEYS.has(key) ? inner : deep(inner);
    }
    return out;
  }

  return {
    text,
    optional: (value) => (value === undefined ? undefined : text(value)),
    nullable: (value) => (value === undefined || value === null ? value : text(value)),
    attributes: maskObject,
  };
}
