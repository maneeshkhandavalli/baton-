"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleHelp, Scale, Send } from "lucide-react";

import { HANDOVER_SECTIONS, blockerLabel, type HandoverSectionId } from "@/components/handover/labels";
import { ReadinessRing } from "@/components/shared/readiness-ring";
import { Button } from "@/components/ui/button";
import type { PointDetail, ReadinessReport } from "@/lib/contracts/dto";
import type { PointCategory } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";
import { statusConfig } from "@/config/status";

export type SectionFilter = "all" | HandoverSectionId | "conflicts" | "gaps";

interface ReadinessPanelProps {
  points: PointDetail[];
  readiness: ReadinessReport | null;
  section: SectionFilter;
  onSection: (s: SectionFilter) => void;
  onBlocker: (kind: ReadinessReport["blockers"][number]["kind"]) => void;
  gapsHref: string | null;
  canPublish: boolean;
  onPublish: (() => void) | null;
  className?: string;
}

function NavButton({ active, onClick, children, count, dots }: { active: boolean; onClick: () => void; children: React.ReactNode; count: number; dots?: PointDetail[] }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        active ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {dots && dots.length > 0 && (
        <span aria-hidden="true" className="flex gap-0.5">
          {dots.slice(0, 6).map((p) => (
            <span key={p.id} className={cn("size-1.5 rounded-full", statusConfig[p.evidenceStatus].className.dot, p.reviewState !== "pending" && "opacity-35")} />
          ))}
        </span>
      )}
      <span className="w-5 text-right font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}

export function ReadinessPanel({ points, readiness, section, onSection, onBlocker, gapsHref, canPublish, onPublish, className }: ReadinessPanelProps) {
  const live = points.filter((p) => p.reviewState !== "rejected");
  const conflicts = live.filter((p) => p.evidenceStatus === "conflicting");
  const gaps = live.filter((p) => p.evidenceStatus === "missing");
  const decided = points.filter((p) => p.reviewState !== "pending").length;

  return (
    <div className={cn("space-y-5", className)}>
      <section aria-labelledby="readiness-heading" className="rounded-xl border border-border bg-card p-4 shadow-soft">
        <div className="flex items-center gap-3">
          <ReadinessRing value={readiness?.score ?? 0} />
          <div className="min-w-0">
            <h2 id="readiness-heading" className="type-subheading">
              Readiness
            </h2>
            <p className="text-xs text-muted-foreground">
              {decided} of {points.length} points decided
            </p>
          </div>
        </div>
        {readiness && (
          <>
            {readiness.blockers.length === 0 ? (
              <p className="mt-3 flex items-center gap-1.5 text-caption font-medium text-success-fg">
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
                Ready to publish
              </p>
            ) : (
              <ul className="mt-3 space-y-1" aria-label="Before you can publish">
                {readiness.blockers.map((b) => (
                  <li key={b.kind}>
                    <button
                      type="button"
                      onClick={() => onBlocker(b.kind)}
                      className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-caption text-foreground/85 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                      {blockerLabel[b.kind](b.count)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {onPublish && (
              <Button className="mt-4 w-full" disabled={!canPublish} onClick={onPublish}>
                <Send aria-hidden="true" data-icon="inline-start" />
                Publish handover
              </Button>
            )}
          </>
        )}
      </section>

      <nav aria-label="Sections" className="space-y-0.5">
        <NavButton active={section === "all"} onClick={() => onSection("all")} count={points.length}>
          All points
        </NavButton>
        {HANDOVER_SECTIONS.map((s) => {
          const inSection = points.filter((p) => (s.categories as readonly PointCategory[]).includes(p.category));
          return (
            <NavButton key={s.id} active={section === s.id} onClick={() => onSection(s.id)} count={inSection.length} dots={inSection}>
              {s.label}
            </NavButton>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-border pt-4">
        <NavButton active={section === "conflicts"} onClick={() => onSection("conflicts")} count={conflicts.length}>
          <span className="inline-flex items-center gap-2">
            <Scale aria-hidden="true" className="size-3.5 text-status-conflicting" />
            Conflicts
          </span>
        </NavButton>
        <NavButton active={section === "gaps"} onClick={() => onSection("gaps")} count={gaps.length}>
          <span className="inline-flex items-center gap-2">
            <CircleHelp aria-hidden="true" className="size-3.5 text-status-missing" />
            Gaps
          </span>
        </NavButton>
        {gapsHref && (
          <Link href={gapsHref} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-caption font-medium text-primary-fg hover:underline">
            Manage the Gap Interview
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
