import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading level; defaults to h2. */
  as?: "h2" | "h3";
  /** `serif` for editorial section titles, `sans` for compact UI sections. */
  variant?: "serif" | "sans";
  id?: string;
  className?: string;
}

export function SectionHeading({
  title,
  description,
  actions,
  as: Heading = "h2",
  variant = "sans",
  id,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1">
        <Heading
          id={id}
          className={cn(
            "text-foreground",
            variant === "serif"
              ? "font-serif text-2xl leading-tight tracking-tight"
              : "text-base font-semibold tracking-tight",
          )}
        >
          {title}
        </Heading>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
