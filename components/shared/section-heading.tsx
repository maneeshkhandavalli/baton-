import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional small label above the title. */
  eyebrow?: ReactNode;
  /** Heading level; defaults to h2. */
  as?: "h2" | "h3";
  /**
   * `serif` — editorial section titles (published handover, wizard step titles, page sections).
   * `sans` — compact UI sections (side panels, lists, settings groups).
   */
  variant?: "serif" | "sans";
  /** Trailing count, rendered muted after the title ("Sources · 3"). */
  count?: number;
  id?: string;
  className?: string;
}

export function SectionHeading({
  title,
  description,
  actions,
  eyebrow,
  as: Heading = "h2",
  variant = "sans",
  count,
  id,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <p className="type-eyebrow text-muted-foreground">{eyebrow}</p>}
        <Heading id={id} className={cn("text-foreground", variant === "serif" ? "type-section-title" : "type-heading")}>
          {title}
          {count !== undefined && <span className="ml-2 font-sans text-sm font-normal text-muted-foreground tabular-nums">{count}</span>}
        </Heading>
        {description && (
          <p className={cn("max-w-2xl text-muted-foreground", variant === "serif" ? "type-body" : "text-sm leading-relaxed")}>{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
