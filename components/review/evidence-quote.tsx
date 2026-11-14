import { CircleAlert, CircleCheck, CircleDashed, FileText, MessageCircle, ShieldAlert, UserRound } from "lucide-react";

import { formatDate, formatDateTime } from "@/components/handover/format";
import { MaskedText } from "@/components/shared/masked-text";
import { isGuardedVerdict } from "@/components/shared/support-guard";
import type { EvidenceKind, QuoteCheck, SupportVerdict } from "@/lib/contracts/enums";
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
  /**
   * Show a compact verification chip (quote found in the source, and whether it backs the claim).
   * Needs `quoteCheck` and `supportVerdict`; review cards pass the whole EvidenceItem.
   */
  showVerification?: boolean;
  quoteCheck?: QuoteCheck;
  supportVerdict?: SupportVerdict;
  verdictRationale?: string | null;
  guarded?: boolean;
  className?: string;
}

const QUOTE_SHORT: Record<QuoteCheck, string> = {
  exact: "Found word for word",
  normalized: "Found in source",
  not_found: "Not found in source",
  pending: "Not checked yet",
};

const VERDICT_SHORT: Partial<Record<SupportVerdict, string>> = {
  supports: "supports the point",
  partial: "partly supports it",
  contradicts: "contradicts the point",
  irrelevant: "not relevant",
};

function VerificationChip({
  kind,
  quoteCheck,
  supportVerdict,
  verdictRationale = null,
  guarded,
}: {
  kind: EvidenceKind;
  quoteCheck: QuoteCheck;
  supportVerdict: SupportVerdict;
  verdictRationale?: string | null;
  guarded?: boolean;
}) {
  if (isGuardedVerdict({ supportVerdict, verdictRationale, guarded })) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-1.5 py-px font-medium text-warning-fg">
        <ShieldAlert aria-hidden="true" className="size-3 shrink-0" />
        Check flagged · read the quote yourself
      </span>
    );
  }
  const quoteOk = kind === "testimony" || quoteCheck === "exact" || quoteCheck === "normalized";
  const bad = quoteCheck === "not_found" || supportVerdict === "contradicts" || supportVerdict === "irrelevant";
  const good = quoteOk && supportVerdict === "supports";
  const Icon = good ? CircleCheck : bad ? CircleAlert : CircleDashed;
  const parts = [kind === "testimony" ? "Accepted answer" : QUOTE_SHORT[quoteCheck], VERDICT_SHORT[supportVerdict]].filter(Boolean);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-px font-medium",
        good && "bg-status-sourced-soft text-status-sourced-fg",
        bad && "bg-status-conflicting-soft text-status-conflicting-fg",
        !good && !bad && "bg-muted text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span className="sr-only">Verification: </span>
      {parts.join(" · ")}
    </span>
  );
}

/**
 * A verbatim quote with who said it, when, and where. Text is always rendered through MaskedText
 * (never as HTML), so masked values stay masked.
 */
export function EvidenceQuote({
  quote,
  kind,
  authorLabel,
  sentAt,
  sourceTitle,
  location,
  tone = "default",
  clamp = false,
  showVerification = false,
  quoteCheck,
  supportVerdict,
  verdictRationale,
  guarded,
  className,
}: EvidenceQuoteProps) {
  const SourceIcon = kind === "testimony" ? UserRound : sentAt ? MessageCircle : FileText;
  const where = location
    ? [location.page ? `p. ${location.page}` : null, location.heading ?? null, `line ${location.lineStart}`].filter(Boolean).join(" · ")
    : null;
  // Separator dots between metadata items (decorative; screen readers hear the items themselves).
  const sep = "before:mr-2 before:text-border-strong before:content-['·'] first:before:hidden";

  return (
    <figure
      className={cn(
        "rounded-r-lg border-l-2 bg-muted/45 py-2.5 pr-3 pl-3.5",
        tone === "default" && "border-l-primary/40",
        tone === "supports" && "border-l-status-sourced",
        tone === "contradicts" && "border-l-status-conflicting",
        tone === "muted" && "border-l-border opacity-70",
        className,
      )}
    >
      <blockquote className={cn("text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]", clamp && "line-clamp-3")}>
        <span aria-hidden="true" className="mr-0.5 font-display text-base leading-none text-muted-foreground">“</span>
        <MaskedText text={quote} />
      </blockquote>
      <figcaption className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <SourceIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="flex min-w-0 flex-wrap items-center gap-y-1">
          {authorLabel && <span className={cn(sep, "font-medium text-foreground/85")}>{authorLabel}</span>}
          {kind === "testimony" && <span className={sep}>Gap Interview answer</span>}
          {sentAt && (
            <time className={cn(sep, "tabular-nums")} dateTime={sentAt}>
              {kind === "testimony" ? formatDate(sentAt) : formatDateTime(sentAt)}
            </time>
          )}
          {sourceTitle && (
            <span className={cn(sep, "max-w-full truncate")} title={sourceTitle}>
              {sourceTitle}
            </span>
          )}
          {where && <span className={cn(sep, "font-mono text-2xs")}>{where}</span>}
        </span>
        {showVerification && quoteCheck && supportVerdict && (
          <VerificationChip kind={kind} quoteCheck={quoteCheck} supportVerdict={supportVerdict} verdictRationale={verdictRationale} guarded={guarded} />
        )}
      </figcaption>
    </figure>
  );
}
