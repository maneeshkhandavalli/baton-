import type { Metadata } from "next";
import { BookOpen, LinkIcon } from "lucide-react";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PublishedHandoverView } from "@/components/published/published-handover-view";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { mockRedeemHandoverLink } from "@/lib/mocks/queries";

export const metadata: Metadata = { title: "Handover" };

export default function SharedHandoverPage({ params }: PageProps<"/h/[token]">) {
  return (
    <PageContainer width="default">
      <Suspense fallback={<LoadingState label="Opening the handover…" className="min-h-96" />}>
        <HandoverContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function HandoverContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Mock stand-in for invite redemption + magic-link session (§12.3, Supabase agent).
  const session = await mockRedeemHandoverLink(token);
  if (!session) {
    return (
      <EmptyState
        icon={<LinkIcon />}
        title="This link isn't valid"
        description="It may have expired or been used already. If you were invited, open the sign-in link we emailed you, or ask the person who invited you for a new one."
      />
    );
  }
  const [handover, published] = await Promise.all([session.queries.getHandover(session.handoverId), session.queries.getPublishedHandover(session.handoverId)]);
  if (!handover.ok || !published.ok) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title="Not published yet"
        description="The team is still reviewing this handover. You'll get an email when it's ready to read."
      />
    );
  }
  return <PublishedHandoverView handover={published.data} viewerLabel={session.viewerLabel} viewerRole={handover.data.viewerRole} />;
}
