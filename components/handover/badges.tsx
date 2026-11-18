import { Clock3, Lock, Shield, Users } from "lucide-react";

import { ContextualHelp } from "@/components/shared/contextual-help";
import { Badge } from "@/components/ui/badge";
import type { AccessLevel, HandoverState } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

import { accessLevelMeta, handoverStateMeta } from "./labels";

/** Lifecycle state of a handover (pill, system tone). */
export function HandoverStateBadge({ state, size = "md", className }: { state: HandoverState; size?: "sm" | "md"; className?: string }) {
  const meta = handoverStateMeta[state];
  return (
    <Badge tone={meta.tone} size={size} dot pulse={state === "processing"} title={meta.description} className={className}>
      {meta.label}
    </Badge>
  );
}

const ACCESS_ICONS = { everyone: Users, leads_only: Shield, reviewer_only: Lock } as const;

/** Who may see a point or source (tag, metadata). Hidden for "Everyone" unless asked. */
export function AccessBadge({ level, className, showEveryone = true }: { level: AccessLevel; className?: string; showEveryone?: boolean }) {
  if (level === "everyone" && !showEveryone) return null;
  const Icon = ACCESS_ICONS[level];
  return (
    <Badge
      shape="tag"
      size="sm"
      tone={level === "everyone" ? "outline" : "neutral"}
      title={accessLevelMeta[level].description}
      className={cn(level !== "everyone" && "text-foreground", className)}
    >
      <Icon aria-hidden="true" />
      {accessLevelMeta[level].label}
    </Badge>
  );
}

/**
 * The latest supporting evidence is old relative to the record (metadata tag, warning tone). The explanation is a
 * real button (ContextualHelp), not a hover-only title, so touch and keyboard users can read it too (R3 Task 06).
 */
export function OutdatedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <Badge shape="tag" size="sm" tone="warning">
        <Clock3 aria-hidden="true" />
        Possibly outdated
      </Badge>
      <ContextualHelp topic="possibly_outdated" label="Why is this possibly outdated?" />
    </span>
  );
}
