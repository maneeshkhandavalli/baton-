"use client";

/**
 * R3 Task 03 (EXT-1/2/3, VER-2/3): minimal functional indicators for extraction coverage, unreviewed
 * signals and review flags. Uses the existing panel styles; no new visual language.
 */

import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, CircleDashed, EyeOff, History, UserRoundSearch } from "lucide-react";

import { ContextualHelp } from "@/components/shared/contextual-help";
import { formatDateTime } from "@/components/handover/format";
import { MaskedText } from "@/components/shared/masked-text";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { reviewPointFlag, reviewSignalMessage } from "@/lib/actions/extraction";
import type {
  ExtractionBlockerKind,
  ExtractionReport,
  PointReviewFlag,
  SourceExtractionCoverage,
  SourceExtractionState,
  UnreviewedSignalMessage,
} from "@/lib/contracts/extraction";
import { unsettledSourceUpdates } from "@/lib/contracts/extraction";
import { cn } from "@/lib/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const extractionBlockerLabel: Record<ExtractionBlockerKind, (n: number) => string> = {
  source_partially_extracted: (n) => `${plural(n, "source was", "sources were")} only partly analysed`,
  source_extraction_failed: (n) => `${plural(n, "source", "sources")} could not be analysed`,
  oversize_messages_skipped: (n) => `${plural(n, "message was", "messages were")} too long to analyse`,
  candidates_discarded: (n) => `${plural(n, "suggested point was", "suggested points were")} discarded by Baton's checks`,
  unreviewed_signals: (n) => `${plural(n, "message looks", "messages look")} relevant but no point uses ${n === 1 ? "it" : "them"}`,
  possible_contradictions: (n) => `${plural(n, "later message", "later messages")} may change a point`,
  unresolved_attribution: (n) => `${plural(n, "person field names", "person fields name")} someone not found in the evidence`,
  coverage_unavailable: (n) => `Coverage was not recorded for ${plural(n, "source")}`,
};

const stateLabel: Record<SourceExtractionState, string> = {
  not_processed: "Not analysed",
  in_progress: "Analysing",
  complete: "Fully analysed",
  complete_with_skips: "Analysed, some messages skipped",
  partial: "Partly analysed",
  failed: "Not analysed (failed)",
};

function SourceLine({ s }: { s: SourceExtractionCoverage }) {
  const ok = s.state === "complete";
  const bad = s.state === "partial" || s.state === "failed";
  const Icon = ok ? CircleCheck : bad ? CircleAlert : CircleDashed;
  return (
    <li className="space-y-0.5">
      {/* R3 Task 06: the name wraps instead of truncating in the narrow review rail; the state reads on its own line */}
      <p className="flex items-start gap-1.5 text-caption font-medium text-foreground">
        <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", ok && "text-success-fg", bad && "text-warning-fg")} />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {s.title ?? "Source"}
          <span className={cn("block font-normal", bad ? "text-warning-fg" : "text-muted-foreground")}>{stateLabel[s.state]}</span>
        </span>
      </p>
      <p className="pl-5 text-caption text-muted-foreground tabular-nums">
        {s.chunksTotal > 0 && `${s.chunksDone} of ${s.chunksTotal} parts · `}
        {plural(s.messagesInspected, "message")} inspected · {s.messagesWithSignals} with signals ({s.signalMessagesLinked} used, {s.signalMessagesUnreviewed} unreviewed)
        {s.oversizeSkipped > 0 && ` · ${s.oversizeSkipped} too long`}
        {s.candidatesDiscarded > 0 && ` · ${s.candidatesDiscarded} discarded`}
      </p>
    </li>
  );
}

/** Coverage summary: per-source completeness, totals and extraction blockers. Renders nothing when unavailable. */
export function ExtractionCoverageSummary({ report, className }: { report: ExtractionReport | null; className?: string }) {
  if (!report?.available || report.completion === "none") return null;
  // R3 Task 05D: a newer version not yet processed or checked, or with changes to decide, is never "fully analysed"
  const unsettled = unsettledSourceUpdates(report);
  const incomplete = report.completion === "partial" || report.completion === "failed" || unsettled.length > 0;
  return (
    <section aria-labelledby="coverage-heading" className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="flex items-center gap-1">
        <h2 id="coverage-heading" className="type-subheading">
          Source coverage
        </h2>
        <ContextualHelp topic="source_coverage" label="What is source coverage?" />
      </div>
      <p className={cn("mt-1 text-xs", incomplete ? "font-medium text-warning-fg" : "text-muted-foreground")}>
        {report.completion === "complete" && unsettled.length === 0 && "Every source was fully analysed."}
        {report.completion === "complete" && unsettled.length > 0 &&
          `Every source processed so far was fully analysed, but ${unsettled.length === 1 ? "a source update still needs" : `${unsettled.length} source updates still need`} processing, checking or a decision.`}
        {report.completion === "in_progress" && "Analysis is still running."}
        {report.completion === "partial" && "Not everything was analysed. Points may be missing."}
        {report.completion === "failed" && "No source could be analysed."}
      </p>
      <ul className="mt-3 space-y-2">
        {report.sources.filter((s) => s.state !== "not_processed").map((s) => (
          <SourceLine key={s.sourceId} s={s} />
        ))}
      </ul>
      {report.blockers.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3" aria-label="Coverage issues">
          {report.blockers.map((b) => (
            <li key={b.kind} className="flex items-start gap-2 text-sm text-foreground/85">
              <span aria-hidden="true" className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", b.severity === "blocking" ? "bg-warning" : "bg-border-strong")} />
              <span>
                {extractionBlockerLabel[b.kind](b.count)}
                {b.severity === "blocking" && <span className="text-muted-foreground"> · confirm before publishing</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Highlights the detected spans inside a (masked, pseudonymised) message body. */
function SignalText({ body, spans }: { body: string; spans: UnreviewedSignalMessage["signals"] }) {
  const ranges = [...spans].filter((s) => s.strength === "strong").sort((a, b) => a.start - b.start);
  const parts: Array<{ text: string; mark: boolean }> = [];
  let at = 0;
  for (const r of ranges) {
    if (r.start < at || r.end > body.length) continue;
    if (r.start > at) parts.push({ text: body.slice(at, r.start), mark: false });
    parts.push({ text: body.slice(r.start, r.end), mark: true });
    at = r.end;
  }
  if (at < body.length) parts.push({ text: body.slice(at), mark: false });
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-sm bg-warning-soft px-0.5 text-foreground">
            <MaskedText text={p.text} />
          </mark>
        ) : (
          <MaskedText key={i} text={p.text} />
        ),
      )}
    </>
  );
}

/** Messages that look like handover material but no point uses: a reviewer adds a point or marks them not relevant. */
export function UnreviewedSignals({ handoverId, items, readOnly }: { handoverId: string; items: UnreviewedSignalMessage[]; readOnly: boolean }) {
  const router = useRouter();
  const { run, isPending } = useAction();
  if (items.length === 0) return null;
  return (
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">Messages no point uses yet ({items.length})</summary>
      <p className="mt-1 text-xs text-muted-foreground">
        Baton&apos;s pattern check found deadlines, amounts, decisions or assignments here. They are hints, not facts: add a point if one matters.
      </p>
      <ul className="mt-3 space-y-3">
        {items.map((m) => (
          <li key={m.messageId} className="space-y-1">
            <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">
              <SignalText body={m.body.length > 600 ? m.body.slice(0, 600) : m.body} spans={m.signals} />
            </p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {m.authorLabel && <MaskedText text={m.authorLabel} />}
              {m.sentAt && <time dateTime={m.sentAt}>{formatDateTime(m.sentAt)}</time>}
              <span>{[...new Set(m.signals.map((s) => s.kind.replace(/_/g, " ")))].join(", ")}</span>
              {!readOnly && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    run(() => reviewSignalMessage({ handoverId, messageId: m.messageId, state: "dismissed" }), {
                      success: "Marked as not relevant",
                      onSuccess: () => router.refresh(),
                    })
                  }
                >
                  <EyeOff aria-hidden="true" data-icon="inline-start" />
                  Not relevant
                </Button>
              )}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

const reasonLabel: Record<string, string> = {
  reversal_marker: "reads like a change of plan",
  decision_marker: "states a decision",
  changed_date: "mentions a different date",
  changed_amount: "mentions a different amount",
  shared_date: "same date",
  shared_amount: "same amount",
  shared_participant: "same people",
  shared_topic: "same topic",
};

const attributionLabel: Record<string, string> = {
  participant_elsewhere: "is a participant, but the cited messages don't name them",
  ambiguous: "matches more than one person",
  unrecognized: "is not a participant and isn't named in the cited messages",
};

/** Review flags for one point (possible later contradictions, unbacked person fields). */
export function PointFlags({ flags, readOnly }: { flags: PointReviewFlag[]; readOnly: boolean }) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const open = flags.filter((f) => f.state === "open");
  if (open.length === 0) return null;
  const act = (id: string, state: "dismissed" | "confirmed") =>
    run(() => reviewPointFlag({ flagId: id, state }), { success: state === "dismissed" ? "Flag dismissed" : "Flag kept", onSuccess: () => router.refresh() });
  return (
    <ul className="space-y-3">
      {open.map((f) => (
        <li key={f.id} className="space-y-1.5 rounded-lg bg-warning-soft/60 px-3 py-2">
          {f.kind === "possible_contradiction" ? (
            <>
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning-fg">
                <History aria-hidden="true" className="size-3.5" />
                A later message may change this point
              </p>
              {f.messageExcerpt && (
                <p className="text-sm [overflow-wrap:anywhere]">
                  <MaskedText text={f.messageExcerpt} />
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {f.messageSentAt && `${formatDateTime(f.messageSentAt)} · `}
                {(f.detail.reasons ?? []).map((r) => reasonLabel[r]).filter(Boolean).join(", ")}. Baton did not change the point or its evidence.
              </p>
            </>
          ) : (
            <p className="flex items-start gap-1.5 text-xs font-medium text-warning-fg">
              <UserRoundSearch aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span>
                The {f.detail.field === "ownerLabel" ? "owner" : f.detail.field === "assigneeLabel" ? "assignee" : "person"} the AI wrote{" "}
                {attributionLabel[f.detail.status ?? ""] ?? "could not be checked"} ({f.kind === "attribution_inferred" ? "inferred" : "unresolved"}).
              </span>
            </p>
          )}
          {!readOnly && (
            <div className="flex gap-1.5">
              <Button size="xs" variant="outline" disabled={isPending} onClick={() => act(f.id, "dismissed")}>
                Not an issue
              </Button>
              <Button size="xs" variant="ghost" disabled={isPending} onClick={() => act(f.id, "confirmed")}>
                Keep as noted
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
