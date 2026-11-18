import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleAlert, Lock } from "lucide-react";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { ChangeReviews } from "@/components/review/change-reviews";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/skeletons";
import { SectionHeading } from "@/components/shared/section-heading";
import { getQueries } from "@/lib/data";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Source changes" };

/** R3 Task 05E: the reviewer's decisions on changes found in source updates. */
export default function ChangesPage({ params }: PageProps<"/handover/[id]/changes">) {
  return (
    <PageContainer className="space-y-8 lg:py-8">
      <SectionHeading
        variant="serif"
        title="Source changes"
        description="What a newer version of a source changes in this handover. Nothing is changed automatically: each change needs a reviewer's decision before the next version is published."
      />
      <Suspense fallback={<ListSkeleton label="Loading changes…" />}>
        <ChangesContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function ChangesContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const queries = getQueries();
  const handover = await queries.getHandover(id);
  if (!handover.ok) notFound();
  const h = handover.data;
  const review = h.viewerRole === "outgoing" || h.viewerRole === "reviewer";
  if (!review) {
    return <EmptyState icon={<Lock />} title="Source changes are for reviewers" description="Only the creator, outgoing member and reviewers can decide changes." />;
  }
  const [items, readiness] = await Promise.all([queries.getChangeReviews(id), queries.getReadiness(id)]);
  if (!items.ok) {
    return (
      <EmptyState tone="error" icon={<CircleAlert />} title="We couldn't load the changes" description={`${items.error.message} Refresh the page to try again.`} />
    );
  }
  return (
    <ChangeReviews
      handoverId={id}
      items={items.data}
      canDecide={h.state === "in_review"}
      handoverState={h.state}
      blockers={readiness.ok ? readiness.data.blockers.map((b) => b.kind) : []}
    />
  );
}
