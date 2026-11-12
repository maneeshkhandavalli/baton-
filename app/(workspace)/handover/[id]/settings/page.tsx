import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { HandoverSettings } from "@/components/settings/handover-settings";
import { FormSkeleton } from "@/components/shared/skeletons";
import { getQueries } from "@/lib/data";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Handover settings" };

export default function HandoverSettingsPage({ params }: PageProps<"/handover/[id]/settings">) {
  return (
    <PageContainer width="narrow" className="lg:py-8">
      <Suspense fallback={<FormSkeleton label="Loading settings…" fields={5} />}>
        <SettingsContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function SettingsContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const queries = getQueries();
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
