import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { ProcessingView } from "@/components/processing/processing-view";
import { EmptyState } from "@/components/shared/empty-state";
import { ProcessingSkeleton } from "@/components/shared/skeletons";
import { getQueries } from "@/lib/data";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Processing" };

export default function ProcessingPage({ params }: PageProps<"/handover/[id]/processing">) {
  return (
    <PageContainer width="wide" className="lg:py-8">
      <Suspense fallback={<ProcessingSkeleton />}>
        <ProcessingContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function ProcessingContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const queries = getQueries();
  const handover = await queries.getHandover(id);
  if (!handover.ok) notFound();
  const h = handover.data;
  const status = await queries.getProcessingStatus(id);
  if (!status.ok) {
    return <EmptyState icon={<Lock />} title="Processing is for reviewers" description="Only the creator, outgoing member and reviewers can see processing details." />;
  }
  return (
    <ProcessingView
      handoverId={id}
      status={status.data}
      canStart={h.viewerIsCreator || h.viewerRole === "outgoing"}
      canCancel={h.viewerIsCreator}
    />
  );
}
