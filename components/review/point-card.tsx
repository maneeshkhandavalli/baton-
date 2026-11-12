"use client";

import { Check, CircleHelp, MessageSquarePlus, PanelRightOpen, Pencil, RotateCcw, Scale, X } from "lucide-react";
import { forwardRef } from "react";

import { AccessBadge, OutdatedBadge } from "@/components/handover/badges";
import { categoryLabel } from "@/components/handover/labels";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { MaskedText } from "@/components/shared/masked-text";
import type { GapQuestionSummary, PointDetail } from "@/lib/contracts/dto";
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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1 hidden rounded border border-current/20 px-1 font-mono text-[0.625rem] leading-4 opacity-60 sm:inline-block">
      {children}
    </kbd>
  );
}

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
  const stale = point.evidence.some((e) => !e.excluded && !e.isCurrentRevisionVerdict && e.supportVerdict !== "irrelevant");

  return (
    <article
      ref={ref}
      aria-labelledby={`point-${point.id}-title`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "group relative scroll-mt-24 rounded-xl border bg-card p-4 shadow-soft transition-[box-shadow,border-color] sm:p-5",
        selected ? "border-primary/50 ring-3 ring-primary/10" : "border-border hover:border-border-strong",
        point.reviewState === "rejected" && "opacity-70",
      )}
    >
      <header className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={status} size="sm" />
        <span className="text-xs text-muted-foreground">{categoryLabel[point.category]}</span>
        <span className="flex-1" />
        {point.isPotentiallyOutdated && <OutdatedBadge />}
        <AccessBadge level={point.accessLevel} showEveryone={false} />
        {decided && (
          <span
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] font-medium",
              point.reviewState === "approved" ? "bg-status-sourced-soft text-status-sourced-fg" : "bg-muted text-muted-foreground",
            )}
          >
            {point.reviewState === "approved" ? <Check aria-hidden="true" className="size-3" /> : <X aria-hidden="true" className="size-3" />}
            {point.reviewState === "approved" ? "Approved" : "Rejected"}
          </span>
        )}
      </header>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        className="mt-2.5 block text-left outline-none focus-visible:underline"
      >
        <h3 id={`point-${point.id}-title`} className="text-[0.9375rem] leading-snug font-semibold text-foreground">
          <MaskedText text={point.title} />
        </h3>
      </button>
      <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground"><MaskedText text={point.statement} /></p>

      <div className="mt-3.5 space-y-2">
        {status === "conflicting" ? (
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-[0.6875rem] font-medium tracking-wide text-status-sourced-fg uppercase">Supports</p>
              {supports.slice(0, 2).map((e) => (
                <EvidenceQuote key={e.pointEvidenceId} {...e} tone="supports" clamp />
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-[0.6875rem] font-medium tracking-wide text-status-conflicting-fg uppercase">Contradicts</p>
              {contradicts.slice(0, 2).map((e) => (
                <EvidenceQuote key={e.pointEvidenceId} {...e} tone="contradicts" clamp />
              ))}
            </div>
          </div>
        ) : status === "missing" ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong bg-status-missing-soft/50 px-3 py-3 sm:flex-row sm:items-center">
            <CircleHelp aria-hidden="true" className="size-4 shrink-0 text-status-missing-fg" />
            <p className="flex-1 text-sm text-status-missing-fg">
              {gapQuestion ? (
                <>
                  <span className="font-medium">In the Gap Interview</span>
                  {" · "}
                  {gapQuestion.status === "open" ? "waiting for an answer" : gapQuestion.status === "answered" ? "answer waiting for review" : "waived"}
                </>
              ) : (
                "No source covers this. Ask the outgoing member in the Gap Interview."
              )}
            </p>
            {!gapQuestion && !readOnly && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction("ask_gap");
                }}
              >
                <MessageSquarePlus aria-hidden="true" data-icon="inline-start" />
                Add to Gap Interview
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
        {stale && (
          <p className="text-xs text-status-inferred-fg">Edited since its quotes were checked. Re-verifying against the new wording…</p>
        )}
        {point.inferredConfirmation && (
          <p className="text-xs text-muted-foreground">
            Inferred · confirmed by <span className="font-medium text-foreground">{point.inferredConfirmation.by}</span>
          </p>
        )}
        {point.conflictResolution && (
          <p className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
            <span className="font-medium">Resolved by {point.conflictResolution.by}: </span>
            <MaskedText className="text-muted-foreground" text={point.conflictResolution.note} />
          </p>
        )}
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <span className="mr-auto text-xs text-muted-foreground">
          {point.evidence.length === 0
            ? "No evidence"
            : `${point.evidence.length} ${point.evidence.length === 1 ? "piece" : "pieces"} of evidence${more > 0 && status !== "conflicting" ? ` · ${more} more` : ""}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="xl:hidden"
          onClick={(e) => {
            e.stopPropagation();
            onAction("details");
          }}
        >
          <PanelRightOpen aria-hidden="true" data-icon="inline-start" />
          Details
        </Button>
        {!readOnly &&
          (decided ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={(e) => {
                e.stopPropagation();
                onAction("reopen");
              }}
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Reopen
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction("reject");
                }}
              >
                <X aria-hidden="true" data-icon="inline-start" />
                Reject
                <Kbd>R</Kbd>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction("edit");
                }}
              >
                <Pencil aria-hidden="true" data-icon="inline-start" />
                Edit
                <Kbd>E</Kbd>
              </Button>
              {status === "conflicting" && !point.conflictResolution && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction("resolve");
                  }}
                >
                  <Scale aria-hidden="true" data-icon="inline-start" />
                  Resolve
                </Button>
              )}
              <Button
                size="sm"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction("approve");
                }}
              >
                <Check aria-hidden="true" data-icon="inline-start" />
                {status === "missing"
                  ? "Approve as gap"
                  : status === "inferred" && !point.inferredConfirmation
                    ? "Confirm & approve"
                    : status === "conflicting" && !point.conflictResolution
                      ? "Resolve & approve"
                      : "Approve"}
                <Kbd>A</Kbd>
              </Button>
            </>
          ))}
      </footer>
    </article>
  );
});
