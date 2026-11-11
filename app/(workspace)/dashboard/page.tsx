import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, Inbox } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const newHandoverLink = (
    <Link href={routes.handover.new} className={buttonVariants({ size: "lg" })}>
      <FilePlus2 aria-hidden="true" data-icon="inline-start" />
      New handover
    </Link>
  );

  return (
    <PageContainer className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Your handovers"
        description="Every handover your organisation is preparing or has passed on."
        actions={newHandoverLink}
      />
      <EmptyState
        icon={<Inbox />}
        title="No handovers yet"
        description="Start a handover to gather your team's documents and turn them into source-backed knowledge for whoever comes next."
        action={newHandoverLink}
      />
    </PageContainer>
  );
}
