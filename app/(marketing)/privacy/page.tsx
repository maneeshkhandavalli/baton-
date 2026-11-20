import type { Metadata } from "next";

import { PRIVACY } from "@/components/legal/privacy";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalMetadata } from "@/components/legal/metadata";

/** /privacy: static and public (content and tests: components/legal). */
export const metadata: Metadata = legalMetadata(PRIVACY);

export default function PrivacyPage() {
  return <LegalDocument doc={PRIVACY} />;
}
