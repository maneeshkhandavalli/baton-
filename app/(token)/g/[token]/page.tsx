import type { Metadata } from "next";
import { LinkIcon } from "lucide-react";
import { Suspense } from "react";

import { GapInterview } from "@/components/gap-interview/gap-interview";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { getQueries } from "@/lib/data";

export const metadata: Metadata = { title: "Gap Interview" };

export default function ContributorGapsPage({ params }: PageProps<"/g/[token]">) {
  return (
    <PageContainer width="prose" className="space-y-8">
      <PageHeader eyebrow="Gap Interview" title="Help fill the gaps" description="A few questions only you can answer, so the next person starts with what matters." />
      <Suspense fallback={<LoadingState label="Opening your questions…" />}>
        <InterviewContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function InterviewContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Server-only token redemption; the token never reaches a URL other than this page (§12.4).
  const result = await getQueries().getGapInterview(token);
  if (!result.ok) {
    return (
      <EmptyState
        tone="error"
        icon={<LinkIcon />}
        title="This link isn't valid"
        description="It may have expired or been turned off. Ask the person who sent it for a new one."
      />
    );
  }
  return <GapInterview token={token} data={result.data} />;
}
