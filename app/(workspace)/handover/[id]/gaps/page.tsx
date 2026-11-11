import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Knowledge gaps" };

export default function GapsPage() {
  return (
    <PageContainer width="wide" className="space-y-8">
      <PageHeader
        eyebrow="Handover"
        title="Knowledge gaps"
        description="Questions no source answers yet. Ask the people who know to fill them in."
      />
      <EmptyState
        icon={<CircleHelp />}
        title="No gaps identified yet"
        description="Missing and conflicting knowledge will be listed here after processing."
      />
    </PageContainer>
  );
}
