import type { Metadata } from "next";
import { MessageSquareText } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Help fill knowledge gaps" };

export default function ContributorGapsPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader
        eyebrow="Contribution request"
        title="Help fill the gaps"
        description="A team is preparing a handover and has questions only you can answer."
      />
      <EmptyState
        icon={<MessageSquareText />}
        title="Questions will appear here"
        description="Contributor links will be connected in a later phase."
      />
    </PageContainer>
  );
}
