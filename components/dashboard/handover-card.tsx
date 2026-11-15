import Link from "next/link";
import { AlertOctagon, ArrowRight, Crown, FileText, Loader2 } from "lucide-react";

import { HandoverStateBadge } from "@/components/handover/badges";
import { formatDate } from "@/components/handover/format";
import { memberRoleLabel } from "@/components/handover/labels";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { cn } from "@/lib/utils";

import type { DashboardRow } from "./model";

/** DraftRow lives in ./draft-row (the dashboards import it there); re-exported for older importers. */
export { DraftRow } from "./draft-row";

export interface HandoverCardData {
  handover: HandoverSummary;
  /** Readiness score for review roles; null when not available to the viewer. */
  readiness: number | null;
  href: string;
  cta: string;
  isDemo: boolean;
  /** For a draft the viewer manages: what is saved and what comes next. */
  draft?: { sources: number; next: string };
  /** Plain-language status and "needs you" items (components/dashboard/model.ts → classify). */
  row?: DashboardRow;
}

/** One line saying where the handover is. Falls back to master's wording when no `row` is supplied. */
function StatusLine({ data }: { data: HandoverCardData }) {
  const { handover: h, row } = data;
  if (row?.health === "failed") {
    return (
      <p className="flex items-start gap-2 text-sm font-medium text-destructive-fg">
        <AlertOctagon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {row.status}
      </p>
    );
  }
  if (h.state === "processing") {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        {row?.status ?? "Baton is reading the sources."}
      </p>
    );
  }
  const text = row?.status ?? (h.currentPublicationId ? "Published and ready to read." : "Not published yet.");
  const needsYou = (row?.attention.length ?? 0) > 0;
  return (
    <p className={cn("flex items-start gap-2 text-sm", needsYou ? "font-medium text-foreground" : "text-muted-foreground")}>
      {needsYou ? (
        <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" />
      ) : (
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <span>
        {needsYou && <span className="sr-only">Needs you: </span>}
        {text}
      </span>
    </p>
  );
}

/**
 * A handover the viewer is preparing, reviewing or receiving. The whole card is one link (the title carries the
 * accessible name, the CTA says what opening it does). Compact: team and state, title, your role, one status line,
 * a progress bar only where it means something (points decided), then date and action.
 */
export function HandoverCard({ data }: { data: HandoverCardData }) {
  const { handover: h, href, cta, row } = data;
  const progress = row?.progress ?? null;
  return (
    <article className="group relative flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-soft transition-[box-shadow,border-color,transform] duration-200 ease-emphasized has-focus-visible:ring-3 has-focus-visible:ring-ring/30 hover:-translate-y-px hover:border-border-strong hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate type-eyebrow text-muted-foreground" title={h.teamName}>
          {h.teamName}
        </p>
        <HandoverStateBadge state={h.state} size="sm" />
      </div>
      <h3 className="mt-2 type-title [overflow-wrap:anywhere]">
        <Link href={href} aria-label={`${h.title}. ${cta}`} className="outline-none after:absolute after:inset-0 after:rounded-xl">
          {h.title}
        </Link>
      </h3>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span>
          You: {memberRoleLabel[h.viewerRole]}
          {h.viewerIsCreator && " · creator"}
        </span>
        {h.pendingCreatorTransfer && (
          <Badge tone="primary" size="sm" shape="tag">
            <Crown aria-hidden="true" />
            {h.viewerIsCreator ? "Creatorship offered" : "Offered to you"}
          </Badge>
        )}
      </p>

      <div className="mt-4 flex-1 space-y-2.5">
        <StatusLine data={data} />
        {progress !== null && row?.progressLabel && (
          <div>
            <div
              role="progressbar"
              aria-label={`${row.progressLabel} in ${h.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="h-1.5 overflow-hidden rounded-full bg-muted ring-1 ring-border/60 ring-inset"
            >
              <div className={cn("h-full rounded-full", progress >= 1 ? "bg-success" : "bg-primary")} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-caption text-muted-foreground">{row.progressLabel}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-caption">
        <span className="text-muted-foreground">Updated {formatDate(h.updatedAt)}</span>
        <span className="inline-flex items-center gap-1 font-medium text-primary-fg">
          {cta}
          <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </div>
    </article>
  );
}

export function HandoverCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-48 flex-col rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <Skeleton className="mt-auto h-3 w-2/3" />
    </div>
  );
}
