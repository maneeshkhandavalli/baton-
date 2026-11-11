import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PublishedHandoverView } from "@/components/published/published-handover-view";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { getQueries } from "@/lib/data";

export const metadata: Metadata = { title: "Published handover" };

/**
 * The current publication, read by membership under RLS (§8.4, §8.5; reconciliation Q3 proposal). Every
 * member reads only the sections their clearance allows; invisible and unknown handovers are a 404.
 */
export default function PublishedPage({ params }: PageProps<"/handover/[id]/published">) {
  return (
    <PageContainer width="default">
      <Suspense fallback={<LoadingState label="Opening the handover…" className="min-h-96" />}>
        <PublishedContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function PublishedContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const queries = getQueries();
  const [handover, members] = await Promise.all([queries.getHandover(id), queries.listMembers(id)]);
  if (!handover.ok) notFound();
  if (!handover.data.currentPublicationId) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title="Not published yet"
        description="The team is still reviewing this handover. You'll be able to read it here once it's published."
      />
    );
  }
  const published = await queries.getPublishedHandover(id);
  if (!published.ok) notFound();
  const viewer = members.ok ? members.data.find((m) => m.isViewer) : undefined;
  return <PublishedHandoverView handover={published.data} viewerLabel={viewer?.displayName ?? "You"} viewerRole={handover.data.viewerRole} />;
}
