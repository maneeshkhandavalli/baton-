import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PreviewHandoverHeader, VariantSwitcher } from "@/components/preview/preview-chrome";
import { ProcessingView } from "@/components/processing/processing-view";
import { ProcessingSkeleton } from "@/components/shared/skeletons";
import type { ProcessingStatus } from "@/lib/contracts/dto";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/contracts/enums";
import { CODECELL_ID } from "@/lib/mocks/fixtures/codecell";
import { PROFILES } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";

// Titles only in development: a production 404 for this route must not name it.
export const metadata: Metadata = { ...(process.env.NODE_ENV === "development" ? { title: "Preview · Processing" } : {}), robots: { index: false, follow: false } };

const VARIANTS = [
  { value: "running", label: "Running" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
  { value: "schema", label: "db_schema_outdated" },
  { value: "nojobs", label: "no_jobs" },
] as const;
type Variant = (typeof VARIANTS)[number]["value"];

/** Dev-only: the processing view in each run state. Start/cancel are hidden (canStart/canCancel false). */
export default function PreviewProcessingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense fallback={<ProcessingSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

type Stage = NonNullable<ProcessingStatus["run"]>["stages"][number];

function stages(spec: Partial<Record<PipelineStage, Stage["status"]>>, fallback: Stage["status"]): Stage[] {
  return PIPELINE_STAGES.map((stage, i) => {
    const status = spec[stage] ?? fallback;
    const total = stage === "parse" ? 3 : 6 + i;
    const done = status === "succeeded" || status === "partial" ? total - (status === "partial" ? 1 : 0) : status === "running" ? Math.ceil(total / 2) : 0;
    return { stage, status, done, total };
  });
}

function run(variant: Variant): ProcessingStatus["run"] {
  const base = { id: "00000000-0000-4000-8000-0000000000aa", startedAt: "2026-11-12T09:00:00.000Z" };
  switch (variant) {
    case "running":
      return { ...base, status: "running", finishedAt: null, error: null, stages: stages({ parse: "succeeded", extract: "succeeded", verify_quotes: "running" }, "queued") };
    case "partial":
      return {
        ...base,
        status: "succeeded",
        finishedAt: "2026-11-12T09:06:00.000Z",
        error: null,
        stages: stages({ parse: "partial", extract: "succeeded", verify_quotes: "succeeded", verify_support: "partial" }, "succeeded"),
      };
    case "failed":
      return {
        ...base,
        status: "failed",
        finishedAt: "2026-11-12T09:03:00.000Z",
        error: { code: "processing_failed", message: "parser:corrupt_file" },
        stages: stages({ parse: "succeeded", extract: "failed" }, "cancelled"),
      };
    case "schema":
      return {
        ...base,
        status: "failed",
        finishedAt: "2026-11-12T09:00:05.000Z",
        error: { code: "precondition_failed", message: "db_schema_outdated" },
        stages: stages({ parse: "failed" }, "cancelled"),
      };
    case "nojobs":
      return { ...base, status: "failed", finishedAt: "2026-11-12T09:00:01.000Z", error: { code: "processing_failed", message: "no_jobs" }, stages: [] };
  }
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const variant: Variant = VARIANTS.some((v) => v.value === q.state) ? (q.state as Variant) : "running";
  const queries = createMockQueries(PROFILES.arjun.id);
  const [handover, sources] = await Promise.all([queries.getHandover(CODECELL_ID), queries.listSources(CODECELL_ID)]);
  if (!handover.ok) return <p className="p-8 text-sm text-muted-foreground">The processing fixture isn&rsquo;t available.</p>;
  const status: ProcessingStatus = {
    handoverState: variant === "running" ? "processing" : variant === "partial" ? "in_review" : "draft",
    run: run(variant),
    sources: sources.ok ? sources.data : [],
  };
  return (
    <>
      <PreviewHandoverHeader handover={{ ...handover.data, state: status.handoverState }} active="Processing" />
      <PageContainer width="wide" className="space-y-6 lg:py-8">
        <VariantSwitcher label="Run state" current={variant} options={VARIANTS.map((v) => ({ ...v, href: `/preview/processing?state=${v.value}` }))} />
        {/* key: switching variants remounts the view (its poll timer follows `active`). */}
        <ProcessingView key={variant} handoverId={CODECELL_ID} status={status} canStart={false} canCancel={false} />
      </PageContainer>
    </>
  );
}
