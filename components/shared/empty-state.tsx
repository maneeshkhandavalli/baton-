import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A rendered icon element, e.g. `<Inbox />`. Sized automatically. */
  icon?: ReactNode;
  /** Primary call to action (one primary button, optionally one outline). */
  action?: ReactNode;
  /**
   * `neutral` — nothing here yet / nothing matches.
   * `error` — something couldn't load; say what happened and what to do.
   * `success` — a finished state (thank-you, all answered).
   * `locked` — the viewer's role can't see this.
   */
  tone?: "neutral" | "error" | "success" | "locked";
  /**
   * `page` — the main content of a page (generous, dashed frame).
   * `inline` — inside a list or panel (compact, no frame).
   */
  variant?: "page" | "inline";
  className?: string;
}

const ICON_TONE = {
  neutral: "border-border bg-card text-muted-foreground",
  error: "border-destructive/20 bg-destructive-soft text-destructive-fg",
  success: "border-success/20 bg-success-soft text-success-fg",
  locked: "border-border bg-muted text-muted-foreground",
} as const;

export function EmptyState({ title, description, icon, action, tone = "neutral", variant = "page", className }: EmptyStateProps) {
  const page = variant === "page";
  return (
    <section
      className={cn(
        "flex flex-col items-center justify-center text-center",
        page ? "rounded-xl border border-dashed border-border-strong/70 px-6 py-16 sm:py-20" : "px-4 py-10",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className={cn(
            "mb-5 flex items-center justify-center rounded-xl border shadow-xs",
            page ? "size-12 [&_svg]:size-5" : "size-10 [&_svg]:size-4.5",
            ICON_TONE[tone],
          )}
        >
          {icon}
        </div>
      )}
      <h2 className={cn("text-foreground", page ? "type-title" : "type-heading")}>{title}</h2>
      {description && <p className="mt-2 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </section>
  );
}
