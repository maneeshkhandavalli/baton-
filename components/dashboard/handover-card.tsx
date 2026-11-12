import Link from "next/link";
import { ArrowRight, Crown, FileText } from "lucide-react";

import { HandoverStateBadge } from "@/components/handover/badges";
import { formatDate } from "@/components/handover/format";
import { memberRoleLabel } from "@/components/handover/labels";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { cn } from "@/lib/utils";

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
}

/**
 * A handover the viewer is preparing, reviewing or receiving. The whole card is one link (the
 * title carries the accessible name); the CTA text says what opening it does.
 */
export function HandoverCard({ data }: { data: HandoverCardData }) {
  const { handover: h, readiness, href, cta } = data;
  return (
    <article className="group relative flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-soft transition-[box-shadow,border-color,transform] duration-200 ease-emphasized has-focus-visible:ring-3 has-focus-visible:ring-ring/30 hover:-translate-y-px hover:border-border-strong hover:shadow-raised motion-reduce:hover:translate-y-0">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate type-eyebrow text-muted-foreground" title={h.teamName}>
          {h.teamName}
        </p>
        <HandoverStateBadge state={h.state} size="sm" />
      </div>
      <h3 className="mt-2 type-title [overflow-wrap:anywhere]">
        <Link href={href} className="outline-none after:absolute after:inset-0 after:rounded-xl">
          {h.title}
        </Link>
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
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

      <div className="mt-6 flex-1">
        {readiness !== null ? (
          <div>
            <div className="flex items-baseline justify-between text-caption">
              <span className="text-muted-foreground">Readiness to publish</span>
              <span className="type-numeric font-medium">{readiness}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={`Readiness for ${h.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={readiness}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div className={cn("h-full rounded-full", readiness === 100 ? "bg-success" : "bg-primary")} style={{ width: `${readiness}%` }} />
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-caption text-muted-foreground">
            <FileText aria-hidden="true" className="size-3.5" />
            {h.currentPublicationId ? "Published and ready to read." : "Not published yet."}
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-3 text-caption">
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
    <div aria-hidden="true" className="flex h-60 flex-col rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <Skeleton className="mt-auto h-1.5 w-full" />
    </div>
  );
}
