/**
 * Structured content for the legal pages (/privacy, /terms, /cookies). The pages render it with LegalDocument, and the
 * tests read it directly, so every statement is checked without rendering TSX. Plain data only: no environment reads,
 * no secrets, no request-time APIs. Text that the owner still has to supply is written as `[Owner to provide: ...]`
 * and is highlighted when rendered.
 */

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "table"; caption: string; head: readonly string[]; rows: readonly (readonly string[])[] };

export interface LegalSection {
  /** Anchor id (lower-case, hyphenated). */
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDocumentContent {
  path: "/privacy" | "/terms" | "/cookies";
  title: string;
  /** One or two sentences under the title; also the meta description. */
  summary: string;
  lastUpdated: string;
  sections: readonly LegalSection[];
}

/** Matches an owner placeholder in rendered text. */
export const OWNER_PLACEHOLDER = /\[Owner to provide: [^\]]+\]/g;

export const LEGAL_LAST_UPDATED = "21 November 2026";

/** Every string of a document, in order (title, summary, headings, paragraphs, list items, table cells). */
export function legalText(doc: LegalDocumentContent): string[] {
  const out: string[] = [doc.title, doc.summary, doc.lastUpdated];
  for (const s of doc.sections) {
    out.push(s.heading);
    for (const b of s.blocks) {
      if (b.kind === "p") out.push(b.text);
      else if (b.kind === "list") out.push(...b.items);
      else out.push(b.caption, ...b.head, ...b.rows.flat());
    }
  }
  return out;
}
