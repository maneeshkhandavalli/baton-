import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { ProcessingView } from "@/components/processing/processing-view";
import { EmptyState } from "@/components/shared/empty-state";
import { ProcessingSkeleton } from "@/components/shared/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { getConsentDisclosure } from "@/lib/ai/consent-disclosure";
import { getQueries } from "@/lib/data";
import { routes } from "@/lib/routes";
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
  // The incoming member reads the published handover; processing is reviewers' work (same gate and notice as
  // Review, Gaps and Changes), never a misleading "Ready to process" without a button.
  if (!h.viewerIsCreator && h.viewerRole !== "outgoing" && h.viewerRole !== "reviewer") {
    return (
      <EmptyState
        icon={<Lock />}
        title="Processing is for reviewers"
        description="Only the creator, the outgoing member and reviewers process the team's record. You can read the published handover instead."
        action={
          <Link href={routes.handover.published(id)} className={buttonVariants()}>
            Read the handover
          </Link>
        }
      />
    );
  }
  const [status, extraction] = await Promise.all([queries.getProcessingStatus(id), queries.getExtractionReport(id)]);
  if (!status.ok) {
    return <EmptyState icon={<Lock />} title="Processing is for reviewers" description="Only the creator, outgoing member and reviewers can see processing details." />;
  }
  return (
    <ProcessingView
      handoverId={id}
      status={status.data}
      canStart={h.viewerIsCreator || h.viewerRole === "outgoing"}
      canCancel={h.viewerIsCreator}
      extraction={extraction.ok ? extraction.data : null}
      consentDisclosure={getConsentDisclosure()}
    />
  );
}
