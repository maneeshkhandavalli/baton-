import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading skeletons that mirror each page's real layout (docs/design/design-system.md → Loading).
 * One status label per skeleton for screen readers; the blocks themselves are hidden from them.
 * Pulses stop under prefers-reduced-motion (globals.css).
 */
function Frame({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className={cn("w-full", className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function HeaderBlock({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-3 border-b border-border pb-8">
      <Skeleton className="h-3 w-24" />
      <Skeleton className={cn("h-10", wide ? "w-2/3" : "w-1/2")} />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
  );
}

function Sheet({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-card p-5", className)}>{children}</div>;
}

/** Dashboard: header + a row list + card grid. */
export function DashboardSkeleton({ withHeader = false, label = "Loading your handovers…" }: { withHeader?: boolean; label?: string }) {
  return (
    <Frame label={label} className="space-y-10">
      {withHeader && <HeaderBlock />}
      <div className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Sheet key={i} className="h-56 space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </Sheet>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** Forms (wizard, settings, account): narrow column of labelled fields. */
export function FormSkeleton({ withHeader = false, label = "Loading…", fields = 4 }: { withHeader?: boolean; label?: string; fields?: number }) {
  return (
    <Frame label={label} className="space-y-8">
      {withHeader && <HeaderBlock />}
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-1 flex-1" />
        ))}
      </div>
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/2" />
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Review: sections panel · point list · evidence pane. */
export function WorkspaceSkeleton({ label = "Loading the review…" }: { label?: string }) {
  return (
    <Frame label={label} className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)_23rem]">
      <div className="hidden space-y-3 lg:block">
        <Sheet className="h-36" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        {[0, 1, 2].map((i) => (
          <Sheet key={i} className="space-y-3">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-14 w-full" />
          </Sheet>
        ))}
      </div>
      <Sheet className="hidden h-[28rem] xl:block" />
    </Frame>
  );
}

/** Processing: run sheet + summary aside. */
export function ProcessingSkeleton() {
  return (
    <Frame label="Loading processing status…" className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Sheet className="space-y-5">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-1.5 w-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </Sheet>
      <Sheet className="h-72" />
    </Frame>
  );
}

/** Published handover / gap interview: a reading column. */
export function DocumentSkeleton({ label = "Opening the handover…", withNav = true }: { label?: string; withNav?: boolean }) {
  return (
    <Frame label={label} className={cn("grid grid-cols-[minmax(0,1fr)] gap-10", withNav && "lg:grid-cols-[13rem_minmax(0,1fr)]")}>
      {withNav && (
        <div className="hidden space-y-2 lg:block">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      )}
      <div className="space-y-10">
        <HeaderBlock wide />
        <div className="space-y-3">
          <Skeleton className="h-7 w-48" />
          <Sheet className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </Sheet>
        </div>
      </div>
    </Frame>
  );
}

/** Lists of objects (gaps manager). */
export function ListSkeleton({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <Frame label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Sheet key={i} className="space-y-2.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </Sheet>
      ))}
    </Frame>
  );
}
