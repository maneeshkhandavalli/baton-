import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The landing page's two calls to action (reference: an ink arrow disc joined to an ink pill; the disc turns and
 * the pill nudges on hover, spring curve): "Start a handover" (primary) and the demo (outlined pill). Used in the
 * hero and the closing card, so the wording and destinations stay identical.
 */
export function LandingCtas({ demoLabel = "Try the demo", className }: { demoLabel?: string; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      <Link href={routes.handover.new} className="lp-cta">
        <span aria-hidden="true" className="lp-cta__disc">
          <ArrowUpRight className="size-4" />
        </span>
        <span className="lp-cta__label">Start a handover</span>
      </Link>
      <Link href={routes.demo} className="lp-cta lp-cta--ghost">
        <span className="lp-cta__label">{demoLabel}</span>
      </Link>
    </div>
  );
}
