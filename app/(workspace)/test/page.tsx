import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { ListSkeleton } from "@/components/shared/skeletons";
import { LiveAiCheck } from "@/components/selftest/live-ai-check";
import { SelfTestReportView } from "@/components/selftest/selftest-report";
import { buildSelfTestReport, getVerifiedOwner } from "@/lib/selftest/server";

export const metadata: Metadata = { title: "Self-check", robots: { index: false, follow: false } };

/**
 * Owner-only self-check (docs/operations/owner-self-check.md). proxy.ts sends signed-out visitors to login and
 * answers 404 to signed-in users who are not on BATON_OWNER_EMAILS; this page verifies the session and the
 * allow-list again before running any check, and is a 404 for everyone else.
 */
export default function SelfTestPage() {
  return (
    <PageContainer width="default" className="space-y-8">
      <Suspense fallback={<ListSkeleton label="Running checks…" rows={6} />}>
        <SelfTestContent />
      </Suspense>
    </PageContainer>
  );
}

async function SelfTestContent() {
  await connection(); // session reads and every check are request-time only
  const owner = await getVerifiedOwner();
  if (!owner) notFound();
  const report = await buildSelfTestReport();
  return (
    <>
      <PageHeader
        eyebrow="Owner only"
        title="Self-check"
        description="Live checks of configuration, database, worker, connectors and pages on this deployment. Secrets are never shown: only presence, lengths, hosts, ids and counts."
      />
      <SelfTestReportView report={report} />
      <LiveAiCheck />
    </>
  );
}
