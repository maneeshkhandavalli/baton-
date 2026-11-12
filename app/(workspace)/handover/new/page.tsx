import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { resumeStep } from "@/components/wizard/draft-state";
import { NewHandoverWizard, type WizardInitial } from "@/components/wizard/new-handover-wizard";
import { getQueries } from "@/lib/data";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "New handover" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function NewHandoverPage({ searchParams }: PageProps<"/handover/new">) {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader
        eyebrow="New handover"
        title="Start a handover"
        description="Four short steps: who is involved, consent for how Baton may read the files, the chats and documents that hold the knowledge, and what Baton may read."
      />
      <Suspense fallback={<LoadingState label="Opening the draft…" className="min-h-64" />}>
        <WizardLoader searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/**
 * `?draft=<id>&step=<n>` reopens a saved draft (refresh, dashboard "Continue editing"). Everything is read
 * through the user's session, so RLS decides visibility; only a draft the viewer may manage reopens here.
 */
async function WizardLoader({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const draft = typeof query.draft === "string" ? query.draft : null;
  if (!draft) return <NewHandoverWizard />;
  if (!UUID.test(draft)) notFound();

  await connection(); // session reads check token expiry against the current time (auth-js)
  const queries = getQueries();
  const [handover, sources, members] = await Promise.all([queries.getHandover(draft), queries.listSources(draft), queries.listMembers(draft)]);
  if (!handover.ok) notFound();
  const h = handover.data;
  const manages = h.viewerIsCreator || h.viewerRole === "outgoing";
  const live = sources.ok ? sources.data.filter((s) => s.state !== "removed") : [];
  // Only a draft that has not been processed belongs in the wizard; anything else continues on its own page.
  if (h.state !== "draft" || !manages || live.some((s) => s.state === "parsed" || s.state === "parsing")) {
    redirect(routes.handover.processing(h.id));
  }

  const viewer = members.ok ? members.data.find((m) => m.isViewer) : undefined;
  const initial: WizardInitial = {
    handoverId: h.id,
    details: {
      title: h.title,
      teamName: h.teamName,
      roleTitle: h.roleTitle ?? "",
      creatorRole: viewer?.role === "outgoing" || viewer?.role === "reviewer" ? viewer.role : "",
    },
    sources: live,
    step: resumeStep(typeof query.step === "string" ? query.step : undefined, live.length),
  };
  return <NewHandoverWizard initial={initial} />;
}
