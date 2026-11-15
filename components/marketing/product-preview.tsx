import { Check, CircleHelp, ScanSearch } from "lucide-react";

import { BatonMark } from "@/components/shared/baton-logo";
import { StatusBadge } from "@/components/shared/status-badge";

/**
 * A static composition of the review screen for the landing page (illustrative, not live data), using the fictional
 * CodeCell demo: Priya Raman hands the technical lead role to Neha Kulkarni, Kabir Shah reviews. One sheet with divided
 * rows (no cards inside cards). The illustration is hidden from assistive tech; the caption says what it shows.
 */
export function ProductPreview() {
  return (
    <figure className="relative">
      <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-card shadow-raised select-none">
        {/* Window bar: which handover this is and where it stands. */}
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
          <BatonMark size="sm" />
          <p className="min-w-0 truncate text-caption font-medium">CodeCell · Technical lead handover</p>
          <span className="ml-auto shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            In review
          </span>
        </div>

        {/* The focused point */}
        <div className="px-4 pt-4 pb-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status="sourced" size="sm" />
            <span className="text-xs text-muted-foreground">Account &amp; access</span>
            <span className="ml-auto inline-flex h-5 items-center gap-1 rounded-full border border-success/25 bg-success-soft px-2 text-2xs font-medium text-success-fg">
              <Check className="size-3" /> Approved · Kabir
            </span>
          </div>
          <p className="mt-2.5 text-md font-semibold">GitHub organisation owners</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Priya and Kabir own codecell-org. Priya adds Neha as an owner before she leaves.</p>
          <blockquote className="mt-3 rounded-lg border-l-2 border-l-status-sourced bg-muted/50 px-3 py-2.5 text-sm leading-relaxed">
            &ldquo;github org owners are me and kabir. recovery codes are in the club password manager, not in chat. i&rsquo;ll add neha as owner before
            i go&rdquo;
          </blockquote>
          <p className="mt-2 font-mono text-2xs text-muted-foreground">↳ Priya Raman · 2 Nov 2026, 16:00 · Core Team 26-27 · line 41</p>
          <p className="mt-1 flex items-center gap-1.5 text-2xs text-status-sourced-fg">
            <ScanSearch className="size-3" /> Quote found word for word · a second check confirmed it backs the point
          </p>
        </div>

        {/* Other points, as rows */}
        <ul className="divide-y divide-border border-t border-border">
          <li className="flex items-center gap-2.5 px-4 py-2.5 sm:px-5">
            <StatusBadge status="conflicting" size="sm" />
            <span className="min-w-0 truncate text-sm">Workshop fee for non-members</span>
            <span className="ml-auto shrink-0 text-2xs text-muted-foreground">2 messages disagree</span>
          </li>
          <li className="flex items-center gap-2.5 px-4 py-2.5 sm:px-5">
            <StatusBadge status="inferred" size="sm" />
            <span className="min-w-0 truncate text-sm">The weekly meeting is on Thursdays</span>
            <span className="ml-auto shrink-0 text-2xs text-muted-foreground">Needs confirming</span>
          </li>
          <li className="flex items-center gap-2.5 px-4 py-2.5 text-status-missing-fg sm:px-5">
            <CircleHelp className="size-4 shrink-0" />
            <span className="min-w-0 truncate text-sm">Who runs the Discord server?</span>
            <span className="ml-auto shrink-0 text-2xs">Sent to Gap Interview</span>
          </li>
        </ul>
      </div>
      <figcaption className="mt-4 text-center text-caption text-muted-foreground">
        Illustration of the review screen, using the fictional CodeCell demo.
      </figcaption>
    </figure>
  );
}
