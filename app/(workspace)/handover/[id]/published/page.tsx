import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PublishedOpenedSignal } from "@/components/onboarding/guidance";
import { PublishedHandoverView } from "@/components/published/published-handover-view";
import { EarlierVersionNotice, VersionSwitcher } from "@/components/published/version-switcher";
import { WhatChangedSummary } from "@/components/published/what-changed-summary";
import { EmptyState } from "@/components/shared/empty-state";
import { DocumentSkeleton } from "@/components/shared/skeletons";
import { getPublicationVersion, listPublicationVersions, parseVersionParam, whatChangedSincePrevious } from "@/lib/actions/core/revisions";
import { getQueries } from "@/lib/data";
import { userDb } from "@/lib/db";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Published handover" };

/**
 * The current publication, read by membership under RLS (§8.4, §8.5; reconciliation Q3 proposal). Every
 * member reads only the sections their clearance allows; invisible and unknown handovers are a 404.
 * Round 4 B (audit E2): `?version=N` reads an earlier version (read-only, same RLS); the switcher lists every
 * version, and a version after the first starts with a dated "What changed since vN" summary.
 */
export default function PublishedPage({ params, searchParams }: PageProps<"/handover/[id]/published">) {
  return (
    <PageContainer width="default" className="lg:py-8">
      <Suspense fallback={<DocumentSkeleton />}>
        <PublishedContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function PublishedContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
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
  const db = await userDb();
  const versions = await listPublicationVersions(db, id);
  const versionList = versions.ok ? versions.data : [];

  const requested = parseVersionParam(sp.version);
  let shown = published.data;
  let earlier = false;
  if (requested !== null && requested !== published.data.version) {
    const old = await getPublicationVersion(db, id, requested);
    if (!old.ok) notFound();
    shown = old.data;
    earlier = true;
  }
  const diff = await whatChangedSincePrevious(db, shown);
  const viewer = members.ok ? members.data.find((m) => m.isViewer) : undefined;
  const role = handover.data.viewerRole;
  const awaitingAck = !earlier && role === "incoming" && !shown.viewerAcknowledgedAt;

  return (
    <div className="space-y-8">
      {/* Round 4: the incoming checklist's "Read the handover" is ticked by actually opening it. */}
      {!earlier && (role === "incoming" || role === "lead") ? <PublishedOpenedSignal /> : null}
      <VersionSwitcher handoverId={id} versions={versionList} selectedVersion={shown.version} />
      {earlier ? <EarlierVersionNotice handoverId={id} version={shown.version} publishedAt={shown.publishedAt} currentVersion={published.data.version} /> : null}
      {diff ? <WhatChangedSummary diff={diff} awaitingAcknowledgement={awaitingAck} /> : null}
      <PublishedHandoverView
        handover={shown}
        viewerLabel={viewer?.displayName ?? "You"}
        viewerRole={role}
        showTitle={false}
        ackDisabledReason={earlier ? `This is version ${shown.version}, an earlier version. Acknowledge the current version instead.` : undefined}
      />
    </div>
  );
}
