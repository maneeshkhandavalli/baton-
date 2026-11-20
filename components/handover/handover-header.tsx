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
    <div className="flex min-w-0 flex-col gap-2 pt-6 pb-4 sm:pt-8">
      <h1 className="type-page-title break-words text-foreground">{h.title}</h1>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-muted-foreground">
        <span>{h.teamName}</span>
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
