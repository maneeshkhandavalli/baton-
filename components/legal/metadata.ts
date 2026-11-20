import type { Metadata } from "next";

import { LEGAL_PAGES_PUBLISHED } from "./published";
import type { LegalDocumentContent } from "./types";

/**
 * Metadata for a legal page: public, and indexable once LEGAL_PAGES_PUBLISHED is on (noindex while the owner details
 * are still placeholders; robots.txt allows these paths; the pages carry no private data).
 * No canonical URL: the app has no metadataBase, and a relative canonical would resolve against the build host.
 */
export function legalMetadata(doc: LegalDocumentContent): Metadata {
  return {
    title: doc.title,
    description: doc.summary,
    robots: LEGAL_PAGES_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: doc.title, description: doc.summary, type: "article" },
  };
}
