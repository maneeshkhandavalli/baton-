import { Clock3, Lock, Shield, Users } from "lucide-react";

import { ContextualHelp } from "@/components/shared/contextual-help";
import { Badge } from "@/components/ui/badge";
import type { AccessLevel, HandoverState } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

import { accessLevelMeta, handoverStateMeta } from "./labels";

/**
 * Lifecycle state pills, drawn like the landing's evidence pills: ink text on a white pill, the colour carried by
 * the dot in the Baton mark's palette (graphite draft, blue processing, ochre in review, ink approved). The final
 * state, acknowledged, is the landing's "live" tag: a highlighter pill. Text is always ink, so contrast holds in
 * both themes.
 */
const STATE_PILL: Record<HandoverState, { tone: "neutral" | "inverse"; dot: string }> = {
  draft: { tone: "neutral", dot: "bg-status-missing" },
  processing: { tone: "neutral", dot: "bg-status-sourced" },
  in_review: { tone: "neutral", dot: "bg-status-inferred" },
  approved: { tone: "neutral", dot: "bg-foreground" },
  acknowledged: { tone: "inverse", dot: "bg-on-highlight" },
};

/** Lifecycle state of a handover (pill). */
export function HandoverStateBadge({ state, size = "md", className }: { state: HandoverState; size?: "sm" | "md"; className?: string }) {
  const meta = handoverStateMeta[state];
  const pill = STATE_PILL[state] ?? { tone: "neutral", dot: "bg-muted-foreground" };
  return (
    <Badge
      tone={pill.tone}
      size={size}
      dot
      dotClassName={pill.dot}
      pulse={state === "processing"}
      title={meta.description}
      className={cn(pill.tone === "neutral" && "border-border-strong text-foreground", className)}
    >
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
