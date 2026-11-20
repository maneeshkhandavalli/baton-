import type { Metadata } from "next";

import { TERMS } from "@/components/legal/terms";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalMetadata } from "@/components/legal/metadata";

/** /terms: static and public (content and tests: components/legal). */
export const metadata: Metadata = legalMetadata(TERMS);

export default function TermsPage() {
  return <LegalDocument doc={TERMS} />;
}
