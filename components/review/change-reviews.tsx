"use client";

/**
 * R3 Task 05E: the reviewer's change-review list. Functional, within the existing design system (Task 05F polishes the
 * full experience). Each kind has its own meaning of accept and reject, its own form and its own required inputs; there
 * is no generic "are you sure" dialog. The database decides whether a decision is allowed and applies it atomically.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ContextualHelp } from "@/components/shared/contextual-help";
import { formatDateTime } from "@/components/handover/format";
import { MaskedText } from "@/components/shared/masked-text";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideChangeReview } from "@/lib/actions/change-reviews";
import {
  CHANGE_REVIEW_KINDS,
  RE_ATTESTATION_MIN,
  changeReviewDetailText,
  changeReviewKindText,
  isUnresolvedChangeReview,
  type ChangeReviewDecision,
  type ChangeReviewItem,
  type ChangeReviewKind,
} from "@/lib/contracts/change-review";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<ChangeReviewItem["state"], { label: string; tone: "warning" | "info" | "success" | "neutral" }> = {
  open: { label: "Needs a decision", tone: "warning" },
  investigating: { label: "Investigating", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
  stale: { label: "Replaced by a newer version", tone: "neutral" },
};

const VERDICT_LABEL: Record<string, string> = {
  supports: "supports the point",
  partial: "partly supports the point",
  contradicts: "contradicts the point",
  irrelevant: "doesn't bear on the point",
  unchecked: "not checked yet",
};

interface ChangeReviewsProps {
  handoverId: string;
  items: ChangeReviewItem[];
  canDecide: boolean;
  handoverState: string;
  blockers: string[];
}

export function ChangeReviews({ handoverId, items, canDecide, handoverState, blockers }: ChangeReviewsProps) {
  const [kind, setKind] = useState<ChangeReviewKind | "all">("all");
  const [showResolved, setShowResolved] = useState(false);
  const unresolved = items.filter((i) => isUnresolvedChangeReview(i.state));
  const counts = useMemo(() => {
    const c = Object.fromEntries(CHANGE_REVIEW_KINDS.map((k) => [k, 0])) as Record<ChangeReviewKind, number>;
    for (const i of unresolved) c[i.kind] += 1;
    return c;
  }, [unresolved]);
  const shown = items.filter((i) => (kind === "all" || i.kind === kind) && (showResolved || isUnresolvedChangeReview(i.state)));
  const otherBlockers = blockers.filter((b) => b !== "change_reviews_open");

  return (
    <div className="space-y-6">
      <section aria-labelledby="changes-summary" className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <div className="flex items-center gap-1">
          <h2 id="changes-summary" className="type-subheading">
            {unresolved.length === 0 ? "No change needs a decision" : `${unresolved.length} ${unresolved.length === 1 ? "change needs" : "changes need"} a decision`}
          </h2>
          <ContextualHelp topic="change_reviews" label="How do source changes work?" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground" role="status" aria-live="polite">
          {unresolved.length > 0
            ? "Publishing the next version is blocked until every change is accepted or rejected. Changes you're investigating still block it."
            : items.length > 0
              ? otherBlockers.length > 0
                ? "Every source change is decided. Other review steps still block publishing: see the review page."
                : "Every source change is decided."
              : "No source update has changed this handover."}
        </p>
        {!canDecide && unresolved.length > 0 && (
          <p className="mt-2 text-caption text-muted-foreground">
            {handoverState === "processing" ? "A source is being processed: decisions open again when it finishes." : "Changes can be decided while the handover is in review."}
          </p>
        )}
        {/* R3 Task 06: with no change at all, filters of zeros and a second "nothing here" line are only noise */}
        {items.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by kind of change">
              <FilterChip active={kind === "all"} onClick={() => setKind("all")} count={unresolved.length}>
                All
              </FilterChip>
              {CHANGE_REVIEW_KINDS.map((k) => (
                <FilterChip key={k} active={kind === k} onClick={() => setKind(k)} count={counts[k]}>
                  {changeReviewKindText[k].label}
                </FilterChip>
              ))}
            </div>
            <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-caption text-muted-foreground">
              <input type="checkbox" className="size-4 accent-primary" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              Show decided and replaced changes
            </label>
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <Link href={routes.handover.review(handoverId)} className="text-sm font-medium text-primary-fg underline-offset-4 hover:underline">
            Open the review
          </Link>
          <Link href={routes.handover.processing(handoverId)} className="text-sm font-medium text-primary-fg underline-offset-4 hover:underline">
            Source updates
          </Link>
        </div>
      </section>

      {items.length === 0 ? null : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{showResolved ? "Nothing to show for this filter." : "No open change for this filter."}</p>
      ) : (
        <ul className="space-y-4" aria-label="Source changes">
          {shown.map((item) => (
            <li key={item.id}>
              <ChangeCard handoverId={handoverId} item={item} canDecide={canDecide} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-ring",
        active ? "border-primary bg-primary-soft text-primary-fg" : "border-border bg-card text-foreground/85 hover:bg-muted",
      )}
    >
      {children}
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function Quote({ text, start, end }: { text: string; start?: number | null; end?: number | null }) {
  if (start === null || start === undefined || end === null || end === undefined || end <= start || end > text.length) {
    return <MaskedText text={text} />;
  }
  return (
    <>
      <MaskedText text={text.slice(0, start)} />
      <mark className="rounded-sm bg-warning-soft px-0.5 text-foreground">
        <MaskedText text={text.slice(start, end)} />
      </mark>
      <MaskedText text={text.slice(end)} />
    </>
  );
}

function ChangeCard({ handoverId, item, canDecide }: { handoverId: string; item: ChangeReviewItem; canDecide: boolean }) {
  const t = changeReviewKindText[item.kind];
  const state = STATE_LABEL[item.state];
  const detail = changeReviewDetailText(item);
  const headingId = useId();
  const unresolved = isUnresolvedChangeReview(item.state);
  const lastNote = [...item.decisions].reverse().find((d) => d.note);

  return (
    <article aria-labelledby={headingId} className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={item.kind === "possible_contradiction" ? "conflicting" : item.kind === "evidence_missing" ? "missing" : "info"}>{t.label}</Badge>
        <Badge tone={state.tone}>{state.label}</Badge>
        <span className="text-caption text-muted-foreground">
          {item.sourceTitle ?? "Source"} · version {item.fromVersion} → {item.toVersion}
        </span>
      </div>
      <h3 id={headingId} className="mt-3 type-subheading">
        {item.kind === "new_information" ? (item.point?.title ?? "New point") : (item.base?.title ?? item.point?.title ?? "Point")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.explain}</p>
      {detail && <p className="mt-1 text-caption text-muted-foreground">{detail}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {item.kind !== "new_information" && (
          <section className="space-y-2 rounded-lg border border-border p-3">
            <h4 className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
              Before: published point{item.base ? ` (revision ${item.base.revisionNumber})` : ""}
            </h4>
            <p className="text-sm">{item.base?.statement ? <MaskedText text={item.base.statement} /> : <span className="text-muted-foreground">Hidden</span>}</p>
            {item.oldEvidence && (
              <blockquote className="border-l-2 border-border-strong pl-3 text-sm text-foreground/85">
                <MaskedText text={item.oldEvidence.quote} />
                <footer className="mt-1 text-caption text-muted-foreground">
                  Historical evidence from version {item.fromVersion}
                  {item.oldEvidence.authorLabel ? <> · <MaskedText text={item.oldEvidence.authorLabel} /></> : null}
                  {item.oldEvidence.sentAt ? ` · ${formatDateTime(item.oldEvidence.sentAt)}` : ""}
                  {item.oldEvidence.verdict ? ` · ${VERDICT_LABEL[item.oldEvidence.verdict] ?? item.oldEvidence.verdict}` : ""}
                </footer>
              </blockquote>
            )}
          </section>
        )}
        <section className={cn("space-y-2 rounded-lg border border-border p-3", item.kind === "new_information" && "md:col-span-2")}>
          <h4 className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">After: version {item.toVersion}</h4>
          {item.kind === "evidence_missing" && (
            <p className="text-sm">
              The quoted words aren&apos;t in version {item.toVersion}. This is not proof that the point is false.
            </p>
          )}
          {item.kind === "new_information" && item.point?.statement && (
            <p className="text-sm">
              <MaskedText text={item.point.statement} />
            </p>
          )}
          {item.newMessage ? (
            <blockquote className="border-l-2 border-primary/40 pl-3 text-sm">
              <Quote text={item.newMessage.body} start={item.newMessage.quoteStart} end={item.newMessage.quoteEnd} />
              <footer className="mt-1 text-caption text-muted-foreground">
                {item.newMessage.authorLabel ? <MaskedText text={item.newMessage.authorLabel} /> : "New version"}
                {item.newMessage.sentAt ? ` · ${formatDateTime(item.newMessage.sentAt)}` : ""}
              </footer>
            </blockquote>
          ) : item.newEvidence ? (
            <blockquote className="border-l-2 border-primary/40 pl-3 text-sm">
              <MaskedText text={item.newEvidence.quote} />
              {item.newEvidence.verdict && (
                <footer className="mt-1 text-caption text-muted-foreground">Now {VERDICT_LABEL[item.newEvidence.verdict] ?? item.newEvidence.verdict}</footer>
              )}
            </blockquote>
          ) : (
            item.kind === "evidence_moved" && <p className="text-sm text-muted-foreground">Several places match, so no single message is shown.</p>
          )}
          {item.kind === "support_changed" && (
            <p className="text-sm">
              Assessment: {VERDICT_LABEL[String(item.detail.from)] ?? String(item.detail.from)} → <strong>{VERDICT_LABEL[String(item.detail.to)] ?? String(item.detail.to)}</strong>
              {item.newEvidence?.rationale ? (
                <span className="mt-1 block text-caption text-muted-foreground">
                  Reason given by the support check: <MaskedText text={item.newEvidence.rationale} />
                </span>
              ) : null}
            </p>
          )}
          {item.point && item.base && item.point.currentRevisionId !== item.base.revisionId && item.kind !== "new_information" && (
            <p className="text-caption text-muted-foreground">The point has been edited since it was published; decisions apply to its current wording.</p>
          )}
        </section>
      </div>

      {item.decisions.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-caption text-muted-foreground">History ({item.decisions.length})</summary>
          <ol className="mt-2 space-y-1">
            {item.decisions.map((d, i) => (
              <li key={i} className="text-caption">
                {formatDateTime(d.createdAt)}: {d.decision === "investigate" ? "Investigating" : d.decision === "accept" ? "Accepted" : "Rejected"}
                {d.note ? <> · <MaskedText text={d.note} /></> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
      {!unresolved && lastNote?.note && item.state !== "stale" && (
        <p className="mt-2 text-caption text-muted-foreground">
          Reviewer note: <MaskedText text={lastNote.note} />
        </p>
      )}
      {item.state === "stale" && (
        <p className="mt-3 text-caption text-muted-foreground">
          {item.staleReason === "source_removed" ? "The source was removed." : "A newer version of this source replaced this one."} No decision is needed; its history is kept.
        </p>
      )}

      {unresolved && canDecide && item.point && <DecisionPanel handoverId={handoverId} item={item} />}
    </article>
  );
}

function DecisionPanel({ handoverId, item }: { handoverId: string; item: ChangeReviewItem }) {
  const router = useRouter();
  const t = changeReviewKindText[item.kind];
  const [decision, setDecision] = useState<ChangeReviewDecision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const point = item.point!;
  // possible_contradiction: the reviewer's own wording and a quotation chosen inside the new message
  const [title, setTitle] = useState(point.title ?? "");
  const [statement, setStatement] = useState(point.statement ?? "");
  const body = item.newMessage?.body ?? "";
  const [span, setSpan] = useState<{ start: number; end: number }>({ start: 0, end: body.length });
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // new_information: what the normal approval needs
  const [confirmInferred, setConfirmInferred] = useState(false);
  const [asKnownGap, setAsKnownGap] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const ids = { note: useId(), title: useId(), statement: useId(), body: useId(), resolution: useId() };

  const ambiguousMove = item.kind === "evidence_moved" && item.newMessage === null;
  const acceptDisabled = ambiguousMove || (item.kind === "possible_contradiction" && item.newMessage === null);
  const noteRequired =
    decision === "investigate" || decision === "reject" || (decision === "accept" && item.kind !== "evidence_moved" && item.kind !== "new_information");
  const noteMin = decision === "accept" && (item.kind === "evidence_missing" || item.kind === "support_changed") ? RE_ATTESTATION_MIN : 1;

  async function submit() {
    if (!decision) return;
    setError(null);
    if (noteRequired && note.trim().length < noteMin) {
      setError(noteMin > 1 ? `Explain why the point still stands (at least ${noteMin} characters).` : "Add a note: it is kept with the decision.");
      return;
    }
    setBusy(true);
    const res = await decideChangeReview({
      handoverId,
      itemId: item.id,
      decision,
      expectedState: item.state === "investigating" ? "investigating" : "open",
      expectedPointRevisionId: point.currentRevisionId,
      note: note.trim() || undefined,
      ...(decision === "accept" && item.kind === "possible_contradiction"
        ? { correction: { title, statement, attributes: point.attributes ?? {}, evidenceStart: span.start, evidenceEnd: span.end } }
        : {}),
      ...(decision === "accept" && item.kind === "new_information"
        ? { approval: { confirmInferred, asKnownGap, resolutionNote: resolutionNote.trim() || undefined } }
        : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.fieldErrors ? Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message : res.error.message);
      return;
    }
    toast.success(
      res.data.outcome === "unchanged"
        ? "That decision was already recorded."
        : decision === "investigate"
          ? "Marked as investigating. It still blocks publishing."
          : decision === "accept"
            ? `${t.accept}: done.`
            : `${t.reject}: recorded.`,
    );
    setDecision(null);
    setNote("");
    router.refresh();
  }

  const options: Array<{ d: ChangeReviewDecision; label: string; help: string; disabled?: boolean }> = [
    { d: "accept", label: t.accept, help: ambiguousMove ? "Not possible: the quotation is in several places." : t.acceptHelp, disabled: acceptDisabled },
    { d: "reject", label: t.reject, help: t.rejectHelp },
    { d: "investigate", label: "Investigate", help: "Keep it open with a note while you check. It still blocks publishing." },
  ];

  return (
    <div className="mt-4 border-t border-border pt-4">
      <fieldset>
        <legend className="text-sm font-medium">Your decision</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((o) => (
            <Button
              key={o.d}
              type="button"
              size="sm"
              variant={decision === o.d ? "default" : "outline"}
              aria-pressed={decision === o.d}
              disabled={o.disabled || busy}
              onClick={() => {
                setDecision(o.d);
                setError(null);
              }}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </fieldset>

      {decision && (
        <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
          <p className="text-sm">{options.find((o) => o.d === decision)?.help}</p>

          {decision === "accept" && item.kind === "possible_contradiction" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={ids.title}>Corrected title</Label>
                <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={ids.statement}>Corrected point, in your words</Label>
                <Textarea id={ids.statement} value={statement} onChange={(e) => setStatement(e.target.value)} rows={3} maxLength={2000} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={ids.body}>Supporting words from version {item.toVersion}</Label>
                <p className="text-caption text-muted-foreground">Select the words that support the correction, then choose “Use selection”. The whole message is used otherwise.</p>
                <Textarea id={ids.body} ref={bodyRef} value={body} readOnly rows={3} className="font-mono text-xs" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const el = bodyRef.current;
                      if (el && el.selectionEnd > el.selectionStart) setSpan({ start: el.selectionStart, end: el.selectionEnd });
                    }}
                  >
                    Use selection
                  </Button>
                  <span className="text-caption text-muted-foreground">
                    Quotation: “<MaskedText text={body.slice(span.start, span.end)} />”
                  </span>
                </div>
              </div>
            </div>
          )}

          {decision === "accept" && item.kind === "new_information" && (
            <div className="space-y-2 text-sm">
              {point.evidenceStatus === "inferred" && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 size-4 accent-primary" checked={confirmInferred} onChange={(e) => setConfirmInferred(e.target.checked)} />
                  This point is inferred, not quoted. I confirm it is right.
                </label>
              )}
              {point.evidenceStatus === "missing" && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 size-4 accent-primary" checked={asKnownGap} onChange={(e) => setAsKnownGap(e.target.checked)} />
                  Approve it as a known gap (no evidence yet).
                </label>
              )}
              {point.evidenceStatus === "conflicting" && (
                <div className="space-y-1">
                  <Label htmlFor={ids.resolution}>How the conflict is resolved</Label>
                  <Textarea id={ids.resolution} value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} rows={2} />
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor={ids.note}>
              {decision === "investigate" ? "What are you checking?" : decision === "reject" ? "Why?" : noteRequired ? "Why (kept with the decision)" : "Note (optional)"}
            </Label>
            <Textarea id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} aria-invalid={!!error} />
            {noteMin > 1 && <p className="text-caption text-muted-foreground">At least {noteMin} characters.</p>}
          </div>

          {error && (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" aria-busy={busy} disabled={busy} onClick={submit}>
              {busy ? "Saving…" : `Save: ${options.find((o) => o.d === decision)?.label}`}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDecision(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
