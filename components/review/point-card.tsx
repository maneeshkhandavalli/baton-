"use client";

import { Check, CircleHelp, MessageSquarePlus, PanelRightOpen, Pencil, RotateCcw, Scale, X } from "lucide-react";
import { forwardRef } from "react";

import { AccessBadge, OutdatedBadge } from "@/components/handover/badges";
import { categoryLabel } from "@/components/handover/labels";
import { keyFacts } from "@/components/shared/key-facts";
import { KeyFactsStrip } from "@/components/shared/key-facts-strip";
import { MaskedText } from "@/components/shared/masked-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { GapQuestionSummary, PointDetail } from "@/lib/contracts/dto";
import type { EvidenceStatus } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

import { EvidenceQuote } from "./evidence-quote";

export type PointAction = "approve" | "edit" | "reject" | "resolve" | "reopen" | "ask_gap" | "details";

interface PointCardProps {
  point: PointDetail;
  selected: boolean;
  readOnly: boolean;
  gapQuestion: GapQuestionSummary | undefined;
  onSelect: () => void;
  onAction: (action: PointAction) => void;
  pending: boolean;
}

/** Left rail colour = evidence status, so conflicts (berry) and gaps (slate, dashed) read apart at a glance. */
const RAIL: Record<EvidenceStatus, string> = {
  sourced: "before:bg-status-sourced",
  inferred: "before:bg-status-inferred",
  conflicting: "before:bg-status-conflicting",
  missing: "before:bg-[repeating-linear-gradient(to_bottom,var(--status-missing)_0_6px,transparent_6px_10px)]",
};

const stop = (fn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn();
};

export const PointCard = forwardRef<HTMLElement, PointCardProps>(function PointCard(
  { point, selected, readOnly, gapQuestion, onSelect, onAction, pending },
  ref,
) {
  const active = point.evidence.filter((e) => !e.excluded && e.quoteCheck !== "not_found" && e.supportVerdict !== "irrelevant");
  const supports = active.filter((e) => e.supportVerdict === "supports");
  const contradicts = active.filter((e) => e.supportVerdict === "contradicts");
  const lead = supports[0] ?? active[0];
  const more = active.length - (lead ? 1 : 0);
  const status = point.evidenceStatus;
  const decided = point.reviewState !== "pending";
  const rejected = point.reviewState === "rejected";
  const stale = point.evidence.some((e) => !e.excluded && !e.isCurrentRevisionVerdict && e.supportVerdict !== "irrelevant");
  const approveLabel =
    status === "missing"
      ? "Approve as gap"
      : status === "inferred" && !point.inferredConfirmation
        ? "Confirm & approve"
        : status === "conflicting" && !point.conflictResolution
          ? "Resolve & approve"
          : "Approve";

  return (
    <article
      ref={ref}
      aria-labelledby={`point-${point.id}-title`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "group relative scroll-mt-24 overflow-hidden rounded-xl border bg-card py-4 pr-4 pl-5 shadow-soft transition-[box-shadow,border-color] duration-150 before:absolute before:inset-y-0 before:left-0 before:w-1 sm:py-5 sm:pr-5 sm:pl-6",
        RAIL[status],
        selected ? "border-primary/50 ring-3 ring-primary/12" : "border-border hover:border-border-strong",
        rejected && "bg-muted/40 before:opacity-40",
      )}
    >
      <header className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={status} size="sm" />
        <span className="text-caption text-muted-foreground">{categoryLabel[point.category]}</span>
        <span className="flex-1" />
        {point.isPotentiallyOutdated && <OutdatedBadge />}
        <AccessBadge level={point.accessLevel} showEveryone={false} />
        {decided && (
          <Badge tone={rejected ? "danger" : "success"} size="sm">
            {rejected ? <X aria-hidden="true" /> : <Check aria-hidden="true" />}
            {rejected ? "Rejected" : "Approved"}
          </Badge>
        )}
      </header>

      {/* Heading outside, button inside (QA-R3-11): headings must not live in interactive content. */}
      <h3 id={`point-${point.id}-title`} className={cn("mt-3 type-heading text-foreground [overflow-wrap:anywhere]", rejected && "text-muted-foreground line-through decoration-1")}>
        <button type="button" onClick={stop(onSelect)} className="rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <MaskedText text={point.title} />
        </button>
      </h3>
      <p className={cn("mt-1 text-sm leading-relaxed text-pretty text-muted-foreground", rejected && "line-clamp-2")}>
        <MaskedText text={point.statement} />
      </p>
      {!rejected && <KeyFactsStrip facts={keyFacts(point.category, point.attributes)} className="mt-3" />}

      {!rejected && (
        <div className="mt-4 space-y-2.5">
          {status === "conflicting" ? (
            <section aria-label="Sources disagree" className="rounded-lg border border-status-conflicting/25 bg-status-conflicting-soft/60 p-3">
              <p className="flex items-center gap-1.5 text-caption font-medium text-status-conflicting-fg">
                <Scale aria-hidden="true" className="size-3.5" />
                {point.conflictResolution ? "Sources disagreed · resolved" : "Sources disagree · decide what is true now"}
              </p>
              <div className="mt-2.5 grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="type-eyebrow text-status-sourced-fg">Supports</p>
                  {supports.length === 0 && <p className="text-caption text-muted-foreground">No supporting quote.</p>}
                  {supports.slice(0, 2).map((e) => (
                    <EvidenceQuote key={e.pointEvidenceId} {...e} tone="supports" clamp />
                  ))}
                </div>
                <div className="space-y-1.5">
                  <p className="type-eyebrow text-status-conflicting-fg">Contradicts</p>
                  {contradicts.length === 0 && <p className="text-caption text-muted-foreground">No contradicting quote.</p>}
                  {contradicts.slice(0, 2).map((e) => (
                    <EvidenceQuote key={e.pointEvidenceId} {...e} tone="contradicts" clamp />
                  ))}
                </div>
              </div>
            </section>
          ) : status === "missing" ? (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-status-missing/45 bg-status-missing-soft/60 px-3 py-3 sm:flex-row sm:items-center">
              <CircleHelp aria-hidden="true" className="size-4 shrink-0 text-status-missing-fg" />
              <p className="flex-1 text-sm text-status-missing-fg">
                {gapQuestion ? (
                  <>
                    <span className="font-medium">Knowledge gap · in the Gap Interview</span>
                    {" — "}
                    {gapQuestion.status === "open" ? "waiting for an answer" : gapQuestion.status === "answered" ? "answer waiting for review" : "waived"}
                  </>
                ) : (
                  <>
                    <span className="font-medium">Knowledge gap.</span> No source covers this. Ask the outgoing member.
                  </>
                )}
              </p>
              {!gapQuestion && !readOnly && (
                <Button size="sm" variant="outline" disabled={pending} onClick={stop(() => onAction("ask_gap"))}>
                  <MessageSquarePlus aria-hidden="true" data-icon="inline-start" />
                  Ask in Gap Interview
                </Button>
              )}
            </div>
          ) : (
            lead && <EvidenceQuote {...lead} tone={lead.supportVerdict === "supports" ? "supports" : "default"} clamp />
          )}

          {status === "inferred" && point.inferenceRationale && !lead && (
            <p className="rounded-lg bg-status-inferred-soft px-3 py-2 text-sm text-status-inferred-fg">
              <span className="font-medium">Inferred: </span>
              <MaskedText text={point.inferenceRationale} />
            </p>
          )}
          {stale && <p className="text-caption text-warning-fg">Edited since its quotes were checked. Re-verifying against the new wording…</p>}
          {point.inferredConfirmation && (
            <p className="text-caption text-muted-foreground">
              Inferred · confirmed by <span className="font-medium text-foreground">{point.inferredConfirmation.by}</span>
            </p>
          )}
          {point.conflictResolution && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">Resolved by {point.conflictResolution.by}: </span>
              <MaskedText className="text-muted-foreground" text={point.conflictResolution.note} />
            </p>
          )}
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="mr-auto text-caption text-muted-foreground">
          {point.evidence.length === 0
            ? "No evidence"
            : `${point.evidence.length} ${point.evidence.length === 1 ? "quote" : "quotes"}${more > 0 && status !== "conflicting" ? ` · ${more} more in details` : ""}`}
        </span>
        <Button size="sm" variant="ghost" className="xl:hidden" onClick={stop(() => onAction("details"))}>
          <PanelRightOpen aria-hidden="true" data-icon="inline-start" />
          Evidence
        </Button>
        {!readOnly &&
          (decided ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={stop(() => onAction("reopen"))}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Undo · reopen
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={pending} onClick={stop(() => onAction("edit"))}>
                <Pencil aria-hidden="true" data-icon="inline-start" />
                Edit
                <Kbd className="ml-0.5 hidden sm:inline-flex">E</Kbd>
              </Button>
              {status === "conflicting" && !point.conflictResolution && (
                <Button size="sm" variant="outline" disabled={pending} onClick={stop(() => onAction("resolve"))}>
                  <Scale aria-hidden="true" data-icon="inline-start" />
                  Resolve
                </Button>
              )}
              <Button size="sm" variant="destructive-outline" disabled={pending} onClick={stop(() => onAction("reject"))}>
                <X aria-hidden="true" data-icon="inline-start" />
                Reject
                <Kbd className="ml-0.5 hidden sm:inline-flex">R</Kbd>
              </Button>
              <Button size="sm" variant="success" disabled={pending} onClick={stop(() => onAction("approve"))}>
                <Check aria-hidden="true" data-icon="inline-start" />
                {approveLabel}
                <Kbd className="ml-0.5 hidden border-success-foreground/30 bg-transparent text-success-foreground sm:inline-flex">A</Kbd>
              </Button>
            </>
          ))}
      </footer>
    </article>
  );
});
