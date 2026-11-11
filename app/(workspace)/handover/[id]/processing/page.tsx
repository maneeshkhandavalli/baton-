import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { ProgressIndicator, type ProgressStep } from "@/components/shared/progress-indicator";

export const metadata: Metadata = { title: "Processing" };

const PIPELINE_STEPS: readonly ProgressStep[] = [
  { id: "ingest", label: "Reading documents" },
  { id: "extract", label: "Extracting knowledge" },
  { id: "verify", label: "Checking sources" },
  { id: "gaps", label: "Identifying gaps" },
];

export default function ProcessingPage() {
  return (
    <PageContainer width="wide" className="space-y-8">
      <PageHeader
        eyebrow="Handover"
        title="Processing"
        description="Baton is reading your documents and tracing every claim back to its source."
      />
      <section className="max-w-xl rounded-xl border border-border bg-card p-6 shadow-soft">
        {/* Not yet connected to the processing pipeline: no step is active. */}
        <ProgressIndicator label="Processing pipeline" steps={PIPELINE_STEPS} currentStep={-1} />
      </section>
    </PageContainer>
  );
}
