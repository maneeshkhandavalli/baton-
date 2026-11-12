import { notFound } from "next/navigation";

import { getQueries } from "@/lib/data";

import { HandoverStateBadge } from "./badges";
import { memberRoleLabel } from "./labels";
import { connection } from "next/server";

/** Title row for /handover/[id]/*. Reads the handover at request time, so render inside <Suspense>. */
export async function HandoverHeader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const result = await getQueries().getHandover(id);
  if (!result.ok) notFound();
  const h = result.data;

  return (
    <div className="flex flex-col gap-3 pt-6 pb-4 sm:flex-row sm:items-end sm:justify-between sm:pt-8">
      <div className="min-w-0 space-y-1">
        <p className="type-eyebrow text-muted-foreground">{h.teamName}</p>
        <h1 className="type-page-title break-words text-foreground">{h.title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-caption text-muted-foreground">
        <span>
          You: {memberRoleLabel[h.viewerRole]}
          {h.viewerIsCreator && " · creator"}
        </span>
        <HandoverStateBadge state={h.state} />
      </div>
    </div>
  );
}

export function HandoverHeaderFallback() {
  return (
    <div aria-hidden="true" className="space-y-2 pt-6 pb-3">
      <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      <div className="h-9 w-72 max-w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
