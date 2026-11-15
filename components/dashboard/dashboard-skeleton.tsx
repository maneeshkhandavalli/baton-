import { Skeleton } from "@/components/ui/skeleton";

import { HandoverCardSkeleton } from "./handover-card";

/** Loading shape of the dashboard body: Up next, a draft row, then a row of cards (same layout as the page). */
export function DashboardBodySkeleton({ label = "Loading your handovers…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-10 lg:space-y-12">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <Skeleton className="h-4 w-20" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5">
            <Skeleton className="size-8 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 min-[1680px]:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <HandoverCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
