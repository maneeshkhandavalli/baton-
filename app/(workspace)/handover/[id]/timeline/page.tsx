import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { DocumentSkeleton } from "@/components/shared/skeletons";
import { HandoverTimeline } from "@/components/timeline/handover-timeline";
import { getQueries } from "@/lib/data";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Timeline" };

/**
 * Decision timeline (docs/product/decision-timeline-plan.md): the current publication in the order things were
 * said. Read by membership under RLS exactly like the Published tab (§8.4, §8.5), so a viewer sees the same
 * points there and here; invisible and unknown handovers are a 404. No new query: getPublishedHandover only.
 */
export default function TimelinePage({ params }: PageProps<"/handover/[id]/timeline">) {
  return (
    <PageContainer width="default" className="lg:py-8">
      <Suspense fallback={<DocumentSkeleton />}>
        <TimelineContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function TimelineContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const queries = getQueries();
  // In parallel: an unpublished handover makes getPublishedHandover fail, which only matters once we know it is published.
  const [handover, published] = await Promise.all([queries.getHandover(id), queries.getPublishedHandover(id)]);
  if (!handover.ok) notFound();
  if (!handover.data.currentPublicationId) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title="Not published yet"
        description="The timeline is built from the published handover. You'll see it here once the team publishes."
      />
    );
  }
  if (!published.ok) notFound();
  return <HandoverTimeline handover={published.data} />;
}
