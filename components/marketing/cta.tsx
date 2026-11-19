import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The landing page's two calls to action as pills: "Start a handover" (primary, lime arrow disc) and the demo
 * (ghost). Used in the hero and the closing band, so the wording and destinations stay identical.
 */
export function LandingCtas({ demoLabel = "Try the demo", className }: { demoLabel?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      <Link href={routes.handover.new} className="bi-cta">
        Start a handover
        <span aria-hidden="true" className="bi-cta__disc">
          <ArrowRight className="size-4" />
        </span>
      </Link>
      <Link href={routes.demo} className="bi-cta bi-cta--ghost">
        {demoLabel}
      </Link>
    </div>
  );
}
