import Link from "next/link";
import { FlaskConical } from "lucide-react";

import { HandoverStateBadge } from "@/components/handover/badges";
import { memberRoleLabel } from "@/components/handover/labels";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { cn } from "@/lib/utils";

/** The dev-only design previews (app/(preview)/preview/**). Synthetic data; never in production. */
export const PREVIEW_PAGES = [
  { href: "/preview/dashboard", label: "Dashboard" },
  { href: "/preview/wizard?step=1", label: "Wizard" },
  { href: "/preview/processing", label: "Processing" },
  { href: "/preview/review", label: "Review" },
  { href: "/preview/published", label: "Published" },
] as const;

/** Sticky strip that says plainly this is a preview, with links between the preview pages. */
export function PreviewBanner() {
  return (
    <div className="sticky top-0 z-30 border-b border-warning/30 bg-warning-soft/95 backdrop-blur-sm max-lg:top-14">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-caption text-warning-fg sm:px-6 lg:px-10 xl:px-12">
        <p className="flex items-center gap-1.5 font-semibold">
          <FlaskConical aria-hidden="true" className="size-3.5" />
          Design preview · synthetic data · actions are turned off
        </p>
        <nav aria-label="Preview pages" className="flex flex-wrap gap-x-3">
          <Link href="/preview" className="underline-offset-4 hover:underline">
            All previews
          </Link>
          {PREVIEW_PAGES.map((p) => (
            <Link key={p.href} href={p.href} className="underline-offset-4 hover:underline">
              {p.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

const TABS = ["Processing", "Review", "Gaps", "Settings", "Published"] as const;
const TAB_HREF: Partial<Record<(typeof TABS)[number], string>> = {
  Processing: "/preview/processing",
  Review: "/preview/review",
  Published: "/preview/published",
};

/**
 * Static stand-in for the handover layout (HandoverHeader + HandoverNav), which read live data and
 * the route id. Same markup and tokens, so screenshots match the real pages.
 */
export function PreviewHandoverHeader({ handover, active }: { handover: HandoverSummary; active: (typeof TABS)[number] }) {
  return (
    <div className="border-b border-border">
      <div className="mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-10 xl:px-12">
        <div className="flex flex-col gap-3 pt-6 pb-4 sm:flex-row sm:items-end sm:justify-between sm:pt-8">
          <div className="min-w-0 space-y-1">
            <p className="type-eyebrow text-muted-foreground">{handover.teamName}</p>
            <h1 className="type-page-title break-words text-foreground">{handover.title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-caption text-muted-foreground">
            <span>
              You: {memberRoleLabel[handover.viewerRole]}
              {handover.viewerIsCreator && " · creator"}
            </span>
            <HandoverStateBadge state={handover.state} />
          </div>
        </div>
        <nav aria-label="Handover sections" className="-mb-px overflow-x-auto [scrollbar-width:none]">
          <ul className="flex gap-6">
            {TABS.map((t) => {
              const href = TAB_HREF[t];
              const cls = cn(
                "inline-flex h-11 items-center border-b-2 text-sm font-medium whitespace-nowrap",
                t === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
              );
              return (
                <li key={t}>
                  {href ? (
                    <Link href={href} aria-current={t === active ? "page" : undefined} className={cn(cls, "hover:text-foreground")}>
                      {t}
                    </Link>
                  ) : (
                    <span className={cn(cls, "opacity-60")}>{t}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

/** Links that switch a preview between its variants (?state=…). */
export function VariantSwitcher({ label, current, options }: { label: string; current: string; options: ReadonlyArray<{ value: string; label: string; href: string }> }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="type-eyebrow text-muted-foreground">{label}</span>
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          aria-current={o.value === current ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium max-sm:h-10",
            o.value === current ? "border-foreground/25 bg-card text-foreground shadow-xs" : "border-transparent bg-muted/60 text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
