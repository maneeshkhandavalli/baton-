import { FileText, MessageCircle, UserRound } from "lucide-react";

import { formatDate, formatDateTime } from "@/components/handover/format";
import { MaskedText } from "@/components/shared/masked-text";
import type { EvidenceKind } from "@/lib/contracts/enums";
import type { MessageLocation } from "@/lib/contracts/parser";
import { cn } from "@/lib/utils";

interface EvidenceQuoteProps {
  quote: string;
  kind: EvidenceKind;
  authorLabel: string | null;
  sentAt: string | null;
  sourceTitle: string | null;
  location?: MessageLocation | null;
  tone?: "default" | "supports" | "contradicts" | "muted";
  /** Clamp long quotes in compact lists. */
  clamp?: boolean;
  className?: string;
}

export function EvidenceQuote({
  quote,
  kind,
  authorLabel,
  sentAt,
  sourceTitle,
  location,
  tone = "default",
  clamp = false,
  className,
}: EvidenceQuoteProps) {
  const SourceIcon = kind === "testimony" ? UserRound : sentAt ? MessageCircle : FileText;
  const where = location
    ? [location.page ? `p. ${location.page}` : null, location.heading ?? null, `line ${location.lineStart}`].filter(Boolean).join(" · ")
    : null;

  return (
    <figure
      className={cn(
        "rounded-lg border-l-2 bg-background/70 py-2.5 pr-3 pl-3",
        tone === "default" && "border-l-primary/40",
        tone === "supports" && "border-l-status-sourced",
        tone === "contradicts" && "border-l-status-conflicting",
        tone === "muted" && "border-l-border opacity-70",
        className,
      )}
    >
      <blockquote className={cn("font-mono text-[0.8125rem] leading-relaxed text-foreground", clamp && "line-clamp-3")}>
        <MaskedText text={quote} />
      </blockquote>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <SourceIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {authorLabel && <span className="font-medium text-foreground/80">{authorLabel}</span>}
        {kind === "testimony" && <span>Gap Interview answer</span>}
        {sourceTitle && <span className="truncate">{sourceTitle}</span>}
        {sentAt && <time dateTime={sentAt}>{kind === "testimony" ? formatDate(sentAt) : formatDateTime(sentAt)}</time>}
        {where && <span className="font-mono text-[0.6875rem]">{where}</span>}
      </figcaption>
    </figure>
  );
}
