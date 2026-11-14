import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** One short line under the value ("of 42 points"). */
  hint?: ReactNode;
  /** `display` — serif numerals for headline figures. `compact` — mono numerals in dense panels. */
  variant?: "display" | "compact";
  className?: string;
}

/**
 * A single figure with its label. Group several in a `<dl className="grid …">` separated by
 * hairlines rather than boxing each one (docs/design/design-system.md → Surfaces).
 */
export function Stat({ label, value, hint, variant = "display", className }: StatProps) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="type-eyebrow text-muted-foreground">{label}</dt>
      <dd className={cn("text-foreground", variant === "display" ? "font-display text-3xl leading-none tabular-nums" : "type-numeric text-lg font-medium")}>
        {value}
      </dd>
      {hint && <dd className="text-caption text-muted-foreground">{hint}</dd>}
    </div>
  );
}
