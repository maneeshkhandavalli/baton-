import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A rendered icon element, e.g. `<Inbox />`. Sized automatically. */
  icon?: ReactNode;
  /** Primary call to action. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <section
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-input bg-card/60 px-6 py-14 text-center",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-soft [&_svg]:size-5"
        >
          {icon}
        </div>
      )}
      <h2 className="font-serif text-2xl leading-tight text-foreground">{title}</h2>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </section>
  );
}
