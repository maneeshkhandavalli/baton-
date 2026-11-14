import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /** Small label above the title: the area ("Workspace") or the parent object (team name). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions. At most one primary button. Wraps below the title on mobile. */
  actions?: ReactNode;
  /** A quiet row under the description: state badge, role, last updated… */
  meta?: ReactNode;
  /** A back link shown above the eyebrow, e.g. `{ href: routes.dashboard, label: "Dashboard" }`. */
  back?: { href: string; label: string };
  /** Hairline under the header. Off when the next element draws its own (e.g. tabs). */
  divider?: boolean;
  className?: string;
}

/**
 * The one h1 of a page (docs/design/design-system.md → Page hierarchy). Serif title, muted
 * description capped at a readable measure, actions aligned to the title's baseline on desktop.
 */
export function PageHeader({ title, eyebrow, description, actions, meta, back, divider = true, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8",
        divider && "border-b border-border pb-6 sm:pb-8",
        className,
      )}
    >
      <div className="min-w-0 space-y-3">
        {back && (
          <Link
            href={back.href}
            className="-ml-1 inline-flex items-center gap-1.5 rounded-sm px-1 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {back.label}
          </Link>
        )}
        {eyebrow && <p className="type-eyebrow text-muted-foreground">{eyebrow}</p>}
        <h1 className="type-page-title text-foreground">{title}</h1>
        {description && <p className="max-w-2xl type-body text-muted-foreground">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-caption text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
