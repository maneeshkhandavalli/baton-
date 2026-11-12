import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PreviewHandoverHeader } from "@/components/preview/preview-chrome";
import { PublishedHandoverView } from "@/components/published/published-handover-view";
import { DocumentSkeleton } from "@/components/shared/skeletons";
import { CODECELL_ID } from "@/lib/mocks/fixtures/codecell";
import { PROFILES } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";

export const metadata: Metadata = { title: "Preview · Published handover", robots: { index: false, follow: false } };

/**
 * Dev-only: what the incoming member (Neha) reads, including the first-week checklist and the real
 * acknowledgement form with its button disabled (no server action).
 */
export default function PreviewPublishedPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense fallback={<DocumentSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const queries = createMockQueries(PROFILES.neha.id);
  const [handover, published] = await Promise.all([queries.getHandover(CODECELL_ID), queries.getPublishedHandover(CODECELL_ID)]);
  if (!handover.ok || !published.ok) return <p className="p-8 text-sm text-muted-foreground">The published fixture isn&rsquo;t available.</p>;
  return (
    <>
      <PreviewHandoverHeader handover={handover.data} active="Published" />
      <PageContainer width="default">
        <PublishedHandoverView
          handover={{ ...published.data, viewerAcknowledgedAt: null }}
          viewerLabel={PROFILES.neha.displayName}
          viewerRole="incoming"
          ackDisabledReason="Preview: acknowledging is turned off here."
        />
      </PageContainer>
    </>
  );
}
