import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { SampleDataPreview } from "@/components/preview/sample-data-preview";
import { PageHeader } from "@/components/shared/page-header";

// Titles only in development: a production 404 for this route must not name it.
export const metadata: Metadata = { ...(process.env.NODE_ENV === "development" ? { title: "Preview · Sample data" } : {}), robots: { index: false, follow: false } };

/**
 * Dev-only: the PROTOTYPE sample-data UI (Sources step card, Sample badges, per-section "Fill with sample
 * data" and the Add a point dialog's replace confirmation) for browser checks at every width and theme,
 * without a session or AI calls. Uses the real components, fixtures and duplicate guard; uploads are simulated
 * locally here (the real upload path is covered by tests/integration/prototype-sample-e2e.test.ts).
 */
export default function PreviewSampleDataPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader eyebrow="Prototype" title="Sample data" description="The sample-data controls exactly as the wizard and the review workspace render them." divider={false} />
      <SampleDataPreview />
    </PageContainer>
  );
}
