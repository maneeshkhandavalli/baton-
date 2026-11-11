import { Eye, Lock, Shield, Users } from "lucide-react";

import type { AccessLevel, HandoverState } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

import { accessLevelMeta, handoverStateMeta } from "./labels";

export function HandoverStateBadge({ state, className }: { state: HandoverState; className?: string }) {
  const meta = handoverStateMeta[state];
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        meta.className,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", meta.dot, state === "processing" && "animate-pulse")} />
      {meta.label}
    </span>
  );
}

const ACCESS_ICONS = { everyone: Users, leads_only: Shield, reviewer_only: Lock } as const;

export function AccessBadge({ level, className, showEveryone = true }: { level: AccessLevel; className?: string; showEveryone?: boolean }) {
  if (level === "everyone" && !showEveryone) return null;
  const Icon = ACCESS_ICONS[level];
  return (
    <span
      title={accessLevelMeta[level].description}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 text-[0.6875rem] font-medium whitespace-nowrap",
        level === "everyone" ? "border-border text-muted-foreground" : "border-foreground/15 bg-foreground/5 text-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {accessLevelMeta[level].label}
    </span>
  );
}

export function OutdatedBadge({ className }: { className?: string }) {
  return (
    <span
      title="The latest supporting evidence is more than 30 days older than the end of the record."
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md border border-status-inferred/30 px-1.5 text-[0.6875rem] font-medium whitespace-nowrap text-status-inferred-fg",
        className,
      )}
    >
      <Eye aria-hidden="true" className="size-3" />
      Possibly outdated
    </span>
  );
}
