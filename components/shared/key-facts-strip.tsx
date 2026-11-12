import { CalendarDays, CircleDot, Info, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

import type { FactKind, KeyFact } from "./key-facts";

const ICONS: Record<FactKind, typeof UserRound> = { person: UserRound, date: CalendarDays, status: CircleDot, info: Info };

/**
 * Owner · due · status as a compact, scannable strip. A real <dl> so screen readers read
 * "Assignee: Neha". Warning/danger tones flag "Unassigned", "No date" and overdue items.
 */
export function KeyFactsStrip({ facts, className }: { facts: KeyFact[]; className?: string }) {
  if (facts.length === 0) return null;
  return (
    <dl className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-caption", className)}>
      {facts.map((f) => {
        const Icon = ICONS[f.kind];
        return (
          <div key={f.label} className="flex min-w-0 items-center gap-1.5">
            <Icon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                f.tone === "danger" ? "text-destructive-fg" : f.tone === "warning" ? "text-warning-fg" : "text-muted-foreground",
              )}
            />
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd
              className={cn(
                "min-w-0 truncate font-medium",
                f.tone === "danger" ? "text-destructive-fg" : f.tone === "warning" ? "text-warning-fg" : "text-foreground",
              )}
              title={f.value}
            >
              {f.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
