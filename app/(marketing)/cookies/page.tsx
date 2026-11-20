import type { Metadata } from "next";

import { COOKIES_PAGE } from "@/components/legal/cookies";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalMetadata } from "@/components/legal/metadata";

/** /cookies: static and public (content and tests: components/legal). */
export const metadata: Metadata = legalMetadata(COOKIES_PAGE);

export default function CookiesPage() {
  return <LegalDocument doc={COOKIES_PAGE} />;
}
