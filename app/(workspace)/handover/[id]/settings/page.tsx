import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { HandoverSettings } from "@/components/settings/handover-settings";
import { LoadingState } from "@/components/shared/loading-state";
import { getMockQueries } from "@/lib/mocks/queries";

export const metadata: Metadata = { title: "Handover settings" };

export default function HandoverSettingsPage({ params }: PageProps<"/handover/[id]/settings">) {
  return (
    <PageContainer width="narrow" className="lg:py-8">
      <Suspense fallback={<LoadingState label="Loading settings…" />}>
        <SettingsContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function SettingsContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const queries = getMockQueries();
  const handover = await queries.getHandover(id);
  if (!handover.ok) notFound();
  const review = handover.data.viewerRole === "outgoing" || handover.data.viewerRole === "reviewer";
  // Review-only reads (§13.1 route table). Other roles never call them, so nothing hints at what they hold.
  const [members, sources, tokens, participants, exclusions] = await Promise.all([
    queries.listMembers(id),
    queries.listSources(id),
    review ? queries.listAccessTokens(id) : null,
    review ? queries.listParticipants(id) : null,
    review ? queries.listExclusions(id) : null,
  ]);
  return (
    <HandoverSettings
      handover={handover.data}
      members={members.ok ? members.data : []}
      sources={sources.ok ? sources.data : []}
      tokens={tokens?.ok ? tokens.data : []}
      participants={participants?.ok ? participants.data : []}
      exclusions={exclusions?.ok ? exclusions.data : []}
    />
  );
}
