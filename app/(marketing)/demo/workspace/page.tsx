import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DemoWorkspace } from "@/components/demo/demo-workspace";
import { initialStepFromQuery } from "@/components/demo/demo-guide";
import { WorkspaceSkeleton } from "@/components/shared/skeletons";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Demo workspace",
  description: "Try a Baton handover end to end with fictional data. Nothing is saved or sent.",
  robots: { index: false },
};

/**
 * The interactive demo (R3 Task 06, frozen contract §2.2). Public: no session, no database, no server function.
 * The whole demo runs in the visitor's tab (components/demo/demo-workspace.tsx on lib/demo/engine). `?step=` opens
 * a step directly; anything else starts at the beginning.
 */
export default function DemoWorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-6 px-4 py-8 sm:px-6 lg:px-10 lg:py-10 xl:px-12">
      <header className="space-y-2">
        <p className="type-eyebrow text-muted-foreground">
          <Link href={routes.demo} className="underline-offset-4 hover:underline">
            Demo
          </Link>{" "}
          · CodeCell, a fictional college coding club
        </p>
        <h1 className="type-page-title">Handing over the technical lead role</h1>
      </header>
      <noscript>
        <p className="rounded-xl border border-border bg-card p-4 text-sm">
          The interactive demo needs JavaScript. You can still <Link href={routes.demo}>browse the read-only demo</Link>.
        </p>
      </noscript>
      <Suspense fallback={<WorkspaceSkeleton label="Opening the demo…" />}>
        <Workspace searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Workspace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <DemoWorkspace initialStep={initialStepFromQuery(query.step)} />;
}
