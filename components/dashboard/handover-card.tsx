import Link from "next/link";
import { ArrowRight, Crown, Sparkles } from "lucide-react";

import { HandoverStateBadge } from "@/components/handover/badges";
import { formatDate } from "@/components/handover/format";
import { memberRoleLabel } from "@/components/handover/labels";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { cn } from "@/lib/utils";

export interface HandoverCardData {
  handover: HandoverSummary;
  /** Readiness score for review roles; null when not available to the viewer. */
  readiness: number | null;
  href: string;
  cta: string;
  isDemo: boolean;
}

export function HandoverCard({ data }: { data: HandoverCardData }) {
  const { handover: h, readiness, href, cta, isDemo } = data;
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-full flex-col rounded-xl border bg-card p-5 shadow-soft transition-[box-shadow,border-color,transform] outline-none hover:-translate-y-px hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:hover:translate-y-0",
        isDemo ? "border-primary/30" : "border-border hover:border-input",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">{h.teamName}</p>
          <h3 className="mt-1 font-serif text-2xl leading-tight tracking-tight text-balance">{h.title}</h3>
        </div>
        {isDemo && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[0.6875rem] font-medium text-primary">
            <Sparkles aria-hidden="true" className="size-3" />
            Demo
          </span>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <HandoverStateBadge state={h.state} />
        <span className="text-xs text-muted-foreground">
          {memberRoleLabel[h.viewerRole]}
          {h.viewerIsCreator && " · creator"}
        </span>
        {h.pendingCreatorTransfer && (
          <span className="inline-flex h-5 items-center gap-1 rounded-md bg-primary/8 px-1.5 text-[0.6875rem] font-medium text-primary">
            <Crown aria-hidden="true" className="size-3" />
            {h.viewerIsCreator ? "Creatorship offered" : "Creatorship offered to you"}
          </span>
        )}
      </div>

      <div className="mt-5 flex-1">
        {readiness !== null ? (
          <div>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Readiness</span>
              <span className="font-mono font-medium tabular-nums">{readiness}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={`Readiness for ${h.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={readiness}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full", readiness === 100 ? "bg-status-sourced" : "bg-primary")}
                style={{ width: `${readiness}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {h.currentPublicationId ? "Published and ready to read." : "Not published yet."}
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">Updated {formatDate(h.updatedAt)}</span>
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          {cta}
          <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

export function HandoverCardSkeleton() {
  return <div aria-hidden="true" className="h-64 animate-pulse rounded-xl border border-border bg-card/60" />;
}
