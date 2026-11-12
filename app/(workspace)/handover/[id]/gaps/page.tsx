import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GapsManager } from "@/components/gaps/gaps-manager";
import { PageContainer } from "@/components/layout/page-container";
import { ListSkeleton } from "@/components/shared/skeletons";
import { SectionHeading } from "@/components/shared/section-heading";
import { getQueries } from "@/lib/data";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Knowledge gaps" };

export default function GapsPage({ params }: PageProps<"/handover/[id]/gaps">) {
  return (
    <PageContainer className="space-y-8 lg:py-8">
      <SectionHeading
        variant="serif"
        title="Gap Interview"
        description="Questions no source answers. Send them to the outgoing member (or anyone who knows) through a private link; no account needed."
      />
      <Suspense fallback={<ListSkeleton label="Loading questions…" />}>
        <GapsContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function GapsContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const queries = getQueries();
  const [handover, questions, points] = await Promise.all([queries.getHandover(id), queries.listGapQuestions(id), queries.listPoints(id)]);
  if (!handover.ok) notFound();
  const review = handover.data.viewerRole === "outgoing" || handover.data.viewerRole === "reviewer";
  return (
    <GapsManager
      handoverId={id}
      questions={questions.ok ? questions.data : []}
      points={points.ok ? points.data : []}
      canManage={review && handover.data.state !== "approved" && handover.data.state !== "acknowledged"}
    />
  );
}
