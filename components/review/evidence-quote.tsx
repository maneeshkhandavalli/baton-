import { CircleAlert, CircleCheck, CircleDashed, FileText, MessageCircle, ShieldAlert, Sparkles, UserRound } from "lucide-react";

import { formatDate, formatDateTime } from "@/components/handover/format";
import { MaskedText } from "@/components/shared/masked-text";
import { isGuardedVerdict } from "@/components/shared/support-guard";
import type { EvidenceKind, QuoteCheck, SupportVerdict } from "@/lib/contracts/enums";
import { AI_LAYER_LABEL, evidenceLayers, QUOTE_LAYER_LABEL } from "@/lib/contracts/verification";
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
  /** Show the line/page location (technical; the evidence panel shows it, review cards do not). */
  showLocation?: boolean;
  quoteCheck?: QuoteCheck;
  supportVerdict?: SupportVerdict;
  verdictRationale?: string | null;
  guarded?: boolean;
  /**
   * Round 4 audit C2: what kind of testimony this is ("Gap Interview answer", "Your statement", "Reviewer statement").
   * Defaults to "Gap Interview answer"; see components/review/testimony-label.ts.
   */
  testimonyLabel?: string;
  className?: string;
}

/**
 * R3 Task 03 (VER-1): two separate chips. The first is the DETERMINISTIC quote check (the words exist in the
 * source); the second is the AI's JUDGEMENT of support, always labelled as such. Neither is a human
 * confirmation, and the two are never merged into one "verified" signal.
 */
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
  const isGuarded = isGuardedVerdict({ supportVerdict, verdictRationale, guarded });
  const layers = evidenceLayers({ kind, quoteCheck, supportVerdict, guarded: isGuarded });
  const quoteOk = layers.quote === "matched_exact" || layers.quote === "matched_normalized" || layers.quote === "testimony";
  const quoteBad = layers.quote === "not_found";
  const QuoteIcon = quoteOk ? CircleCheck : quoteBad ? CircleAlert : CircleDashed;
  const aiLabel = AI_LAYER_LABEL[layers.ai];
  const aiGood = layers.ai === "judged_supportive";
  const aiBad = layers.ai === "judged_contradicting" || layers.ai === "judged_irrelevant";
  return (
    <>
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          quoteOk && "text-status-sourced-fg",
          quoteBad && "text-status-conflicting-fg",
          !quoteOk && !quoteBad && "text-muted-foreground",
        )}
      >
        <QuoteIcon aria-hidden="true" className="size-3 shrink-0" />
        <span className="sr-only">Quote check: </span>
        {QUOTE_LAYER_LABEL[layers.quote]}
      </span>
      {aiLabel && (
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            layers.ai === "guarded" && "text-warning-fg",
            aiGood && "text-foreground/80",
            aiBad && "text-status-conflicting-fg",
            !aiGood && !aiBad && layers.ai !== "guarded" && "text-muted-foreground",
          )}
        >
          {layers.ai === "guarded" ? <ShieldAlert aria-hidden="true" className="size-3 shrink-0" /> : <Sparkles aria-hidden="true" className="size-3 shrink-0" />}
          <span className="sr-only">Not a human confirmation: </span>
          {aiLabel}
        </span>
      )}
    </>
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
  showLocation = true,
  quoteCheck,
  supportVerdict,
  verdictRationale,
  guarded,
  testimonyLabel = "Gap Interview answer",
  className,
}: EvidenceQuoteProps) {
  const SourceIcon = kind === "testimony" ? UserRound : sentAt ? MessageCircle : FileText;
  const where = showLocation && location
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
      <figcaption className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <SourceIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-y-1">
          {authorLabel && (
            <span className={cn(sep, "font-medium text-foreground/85")}>
              <MaskedText text={authorLabel} />
            </span>
          )}
          {kind === "testimony" && <span className={sep}>{testimonyLabel}</span>}
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
          {where && <span className={cn(sep, "font-mono text-xs")}>{where}</span>}
        </span>
        {showVerification && quoteCheck && supportVerdict && (
          <VerificationChip kind={kind} quoteCheck={quoteCheck} supportVerdict={supportVerdict} verdictRationale={verdictRationale} guarded={guarded} />
        )}
      </figcaption>
    </figure>
  );
}
