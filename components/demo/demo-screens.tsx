"use client";

import { ArrowRight, CheckCircle2, FileText, MessageCircle, MessageCircleQuestion, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { formatCount, formatDate, formatDateRange } from "@/components/handover/format";
import { blockerLabel, maskKindLabel, sourceKindLabel } from "@/components/handover/labels";
import { ACK_STATEMENT_VERSION, PublishedHandoverView } from "@/components/published/published-handover-view";
import { directApproveInput } from "@/components/review/evidence-state";
import { ExtractionCoverageSummary } from "@/components/review/extraction-coverage";
import { PointCard, type PointAction } from "@/components/review/point-card";
import { PointDetailPanel } from "@/components/review/point-detail-panel";
import { ReviewDialogs, type ReviewDialogState } from "@/components/review/review-dialogs";
import { MaskedText } from "@/components/shared/masked-text";
import { HandoverTimeline } from "@/components/timeline/handover-timeline";
import { ReadinessRing } from "@/components/shared/readiness-ring";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Result } from "@/lib/contracts/api";
import type { PointDetail, ReadinessReport } from "@/lib/contracts/dto";
import type { ReviewPointInput } from "@/lib/contracts/schemas";
import type { DemoAction } from "@/lib/demo/engine";

import { changeReviewKindText, type ChangeReviewDecision, type ChangeReviewItem } from "@/lib/contracts/change-review";

import {
  acknowledgePublication,
  changeDecisionInput,
  decideChangeReview,
  isDemoReviewAction,
  publishHandover,
  reviewGapAnswer,
  reviewPoint,
  submitGapAnswer,
} from "./demo-dispatch";
import { DECISION_CATEGORIES, type DemoScreen } from "./demo-guide";
import { answersToReview, gapForPoint, openChanges, type DemoView } from "./demo-view-model";

type Dispatch = (action: DemoAction, success: string) => Promise<Result<unknown>>;

interface ScreenProps {
  screen: DemoScreen;
  view: DemoView;
  pending: boolean;
  dispatch: Dispatch;
  onNext: (() => void) | null;
}

const REVIEW_SUCCESS: Partial<Record<ReviewPointInput["action"], string>> = {
  approve: "Point approved",
  reject: "Point rejected",
  edit: "Saved as a new revision",
  resolve_conflict: "Conflict resolved",
  confirm_inferred: "Inferred point confirmed",
};

/** One demo step's screen. Reuses the presentational review and published components with demo data. */
export function DemoScreenView({ screen, view, pending, dispatch, onNext }: ScreenProps) {
  switch (screen) {
    case "sources":
      return <SourcesScreen view={view} />;
    case "draft":
      return (
        <div className="space-y-6">
          <ExtractionCoverageSummary report={view.extraction} />
          <PointList view={view} points={view.points} readOnly pending={pending} dispatch={dispatch} />
        </div>
      );
    case "review":
      return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <ReadinessSummary readiness={view.readiness} decided={decidedCount(view.points)} total={view.points.length} />
          <PointList view={view} points={view.points} readOnly={false} pending={pending} dispatch={dispatch} />
        </div>
      );
    case "decisions":
      return <PointList view={view} points={view.points.filter((p) => DECISION_CATEGORIES.has(p.category))} readOnly={false} pending={pending} dispatch={dispatch} />;
    case "publish":
      return <PublishScreen view={view} pending={pending} dispatch={dispatch} onNext={onNext} />;
    case "receive":
      return <ReceiveScreen view={view} pending={pending} dispatch={dispatch} />;
  }
}

const decidedCount = (points: PointDetail[]) => points.filter((p) => p.reviewState !== "pending").length;

/* ── Step 1: sources ─────────────────────────────────────────────────────────────────────────────────────── */

function SourcesScreen({ view }: { view: DemoView }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Sources">
      {view.sources.map((s) => {
        const masked = Object.entries(s.maskingCounts ?? {}).filter(([, n]) => (n ?? 0) > 0);
        const Icon = s.kind === "whatsapp_export" ? MessageCircle : FileText;
        return (
          <li key={s.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <p className="flex items-start gap-2 text-sm font-medium [overflow-wrap:anywhere]">
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {s.title}
            </p>
            <p className="text-caption text-muted-foreground">
              {sourceKindLabel[s.kind]}
              {s.messageCount !== null && ` · ${formatCount(s.messageCount)} ${s.kind === "whatsapp_export" ? "messages" : "blocks"}`}
              {s.firstMessageAt && ` · ${formatDateRange(s.firstMessageAt, s.lastMessageAt)}`}
            </p>
            <div className="space-y-1 border-t border-border pt-3 text-caption">
              <p className="flex items-center gap-1.5">
                <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-success-fg" />
                {masked.length ? `Masked: ${masked.map(([k, n]) => `${maskKindLabel[k as keyof typeof maskKindLabel].label.toLocaleLowerCase()} (${n})`).join(", ")}` : "Nothing needed masking"}
              </p>
              <p className="text-muted-foreground">
                {s.consentRecordedAt ? `Consent recorded ${formatDate(s.consentRecordedAt)}` : "No consent yet"}
                {s.rawDeletedAt ? ` · raw upload deleted ${formatDate(s.rawDeletedAt)}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Steps 2–4: points ───────────────────────────────────────────────────────────────────────────────────── */

function PointList({ view, points, readOnly, pending, dispatch }: { view: DemoView; points: PointDetail[]; readOnly: boolean; pending: boolean; dispatch: Dispatch }) {
  const [selectedId, setSelectedId] = useState<string | null>(points[0]?.id ?? null);
  const [dialog, setDialog] = useState<ReviewDialogState>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selected = points.find((p) => p.id === selectedId) ?? points[0] ?? null;

  async function submit(input: ReviewPointInput): Promise<boolean> {
    if (!isDemoReviewAction(input)) {
      toast.info("That isn't part of the demo.");
      return false;
    }
    const r = await dispatch(reviewPoint(input), REVIEW_SUCCESS[input.action] ?? "Saved");
    return r.ok;
  }

  function act(point: PointDetail, action: PointAction) {
    setSelectedId(point.id);
    switch (action) {
      case "details":
        setDetailsOpen(true);
        return;
      case "approve": {
        const direct = directApproveInput(point);
        if (direct) void submit(direct);
        else setDialog({ kind: "approve", point });
        return;
      }
      case "reject":
      case "edit":
      case "resolve":
        setDialog({ kind: action, point });
        return;
      default:
        // reopen, ask_gap: real-product actions the demo leaves out (A1)
        toast.info("That isn't part of the demo. Use “Reset this step” to start the step again.");
    }
  }

  if (points.length === 0) return <p className="text-sm text-muted-foreground">No points to show in this step.</p>;

  const panel = selected && <PointDetailPanel point={selected} sources={view.sources} readOnly pending={false} onExclude={() => {}} onRestore={() => {}} onChangeAccess={() => {}} />;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <ul className="space-y-4" aria-label="Points">
        {points.map((p) => (
          <li key={p.id}>
            <PointCard
              point={p}
              selected={p.id === selected?.id}
              readOnly={readOnly}
              gapQuestion={gapForPoint(view.gaps, p.id)}
              onSelect={() => setSelectedId(p.id)}
              onAction={(a) => act(p, a)}
              pending={pending}
            />
          </li>
        ))}
      </ul>
      {/* ≥ xl the evidence sits beside the list; below that the card's “Evidence” button opens it. */}
      <aside aria-label="Evidence" className="hidden xl:block">
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border border-border bg-card">{panel}</div>
      </aside>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto p-0 xl:hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Evidence</DialogTitle>
          </DialogHeader>
          {panel}
        </DialogContent>
      </Dialog>
      <ReviewDialogs state={dialog} onClose={() => setDialog(null)} onSubmit={submit} pending={pending} />
    </div>
  );
}

function ReadinessSummary({ readiness, decided, total }: { readiness: ReadinessReport | null; decided: number; total: number }) {
  return (
    <section aria-labelledby="demo-readiness" className="h-fit space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <ReadinessRing value={readiness?.score ?? 0} />
        <div>
          <h3 id="demo-readiness" className="type-subheading">
            Readiness
          </h3>
          <p className="text-xs text-muted-foreground">
            {decided} of {total} points decided
          </p>
        </div>
      </div>
      {readiness && (
        <ul className="space-y-1.5 text-sm">
          {readiness.blockers.length === 0 ? (
            <li className="flex items-center gap-2 text-success-fg">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Nothing blocks publishing
            </li>
          ) : (
            readiness.blockers.map((b) => (
              <li key={b.kind} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                {blockerLabel[b.kind]?.(b.count) ?? "Something still blocks publishing"}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}

/* ── Step 5: publish ─────────────────────────────────────────────────────────────────────────────────────── */

function PublishScreen({ view, pending, dispatch, onNext }: { view: DemoView; pending: boolean; dispatch: Dispatch; onNext: (() => void) | null }) {
  const [summary, setSummary] = useState("");
  const published = view.published;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ReadinessSummary readiness={view.readiness} decided={decidedCount(view.points)} total={view.points.length} />
      <section aria-labelledby="demo-publish" className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h3 id="demo-publish" className="type-subheading">
          {published ? `Published · version ${published.version}` : "Publish the handover"}
        </h3>
        {published ? (
          <>
            <p className="text-sm text-muted-foreground">
              Published {formatDate(published.publishedAt)} by {published.publishedByLabel}. Neha can now read it and acknowledge it.
            </p>
            {onNext && (
              <Button type="button" onClick={onNext}>
                See what Neha receives
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            )}
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void dispatch(publishHandover(view.handover.id, summary), "Handover published");
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="demo-summary">A note for Neha (optional)</Label>
              <Textarea id="demo-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} />
            </div>
            <Button type="submit" disabled={pending || !view.readiness?.canPublish}>
              <Send aria-hidden="true" data-icon="inline-start" />
              Publish handover
            </Button>
            {!view.readiness?.canPublish && <p className="text-caption text-muted-foreground">Publishing unlocks when nothing on the readiness list blocks it. Go back to Review to finish.</p>}
          </form>
        )}
      </section>
    </div>
  );
}

/* ── Step 6: Neha receives it; the Gap Interview ─────────────────────────────────────────────────────────── */

function ReceiveScreen({ view, pending, dispatch }: { view: DemoView; pending: boolean; dispatch: Dispatch }) {
  const published = view.published;
  const open = view.gaps.filter((g) => g.status === "open" && !g.privacyHeld);
  const toReview = answersToReview(view.gaps);
  return (
    <div className="space-y-8">
      {published ? (
        <>
          <section aria-labelledby="demo-ack" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="demo-ack" className="type-subheading">
                {published.viewerAcknowledgedAt ? "Neha acknowledged the handover" : "Acknowledge as Neha"}
              </h3>
              <p className="text-caption text-muted-foreground">
                {published.viewerAcknowledgedAt
                  ? `On ${formatDate(published.viewerAcknowledgedAt)}, for version ${published.version}.`
                  : "The incoming member confirms they've read it. Priya sees the acknowledgement."}
              </p>
            </div>
            {!published.viewerAcknowledgedAt && (
              <Button type="button" disabled={pending} onClick={() => void dispatch(acknowledgePublication(published.publicationId, ACK_STATEMENT_VERSION), "Acknowledged as Neha")}>
                <CheckCircle2 aria-hidden="true" data-icon="inline-start" />
                I&rsquo;ve read it
              </Button>
            )}
          </section>
          <div className="rounded-2xl border border-border bg-background p-4 sm:p-8">
            <PublishedHandoverView handover={published} viewerLabel="Neha Kulkarni" viewerRole="incoming" preview />
            {/* Decision timeline: the same publication in date order (docs/product/decision-timeline-plan.md) */}
            <div className="mt-14 border-t border-border pt-10">
              <HandoverTimeline handover={published} />
            </div>
          </div>
        </>
      ) : (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Nothing is published yet. Go back to Publish first.</p>
      )}

      {view.changes.length > 0 && <ChangesSection view={view} pending={pending} dispatch={dispatch} />}

      <section aria-labelledby="demo-gaps" className="space-y-4">
        <div>
          <h3 id="demo-gaps" className="type-section-title">
            Gap Interview
          </h3>
          <p className="text-sm text-muted-foreground">Questions no source could answer. Answer one as Ananya, who knows, then accept the answer as Priya.</p>
        </div>
        {open.length === 0 && toReview.length === 0 && <p className="text-sm text-muted-foreground">No open questions.</p>}
        <ul className="space-y-4">
          {open.map((g) => (
            <li key={g.id}>
              <GapAnswerForm questionId={g.id} question={g.question} context={g.context} pending={pending} dispatch={dispatch} />
            </li>
          ))}
          {toReview.map(({ question, answer }) => (
            <li key={answer.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-medium">{question.question}</p>
              <blockquote className="rounded-r-lg border-l-2 border-l-primary/40 bg-muted/45 px-3 py-2 text-sm">
                <MaskedText text={answer.text} />
                <footer className="mt-1 text-caption text-muted-foreground">{answer.answererLabel}</footer>
              </blockquote>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="success" disabled={pending} onClick={() => void dispatch(reviewGapAnswer(answer.id, "accept"), "Answer accepted as Priya")}>
                  Accept as Priya
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void dispatch(reviewGapAnswer(answer.id, "reject"), "Answer rejected")}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function GapAnswerForm({ questionId, question, context, pending, dispatch }: { questionId: string; question: string; context: string | null; pending: boolean; dispatch: Dispatch }) {
  const [text, setText] = useState("");
  const id = `gap-${questionId}`;
  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        void dispatch(submitGapAnswer(questionId, text, "Ananya Iyer"), "Answer sent as Ananya").then((r) => r.ok && setText(""));
      }}
    >
      <p className="flex items-start gap-2 text-sm font-medium">
        <MessageCircleQuestion aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-missing-fg" />
        <label htmlFor={id}>{question}</label>
      </p>
      {context && <p className="text-caption text-muted-foreground">{context}</p>}
      <Textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Answer as Ananya Iyer" />
      <Button type="submit" size="sm" disabled={pending || !text.trim()}>
        Send answer as Ananya
      </Button>
    </form>
  );
}

/* ── Step 6 (continued): a source update after publishing (Task 05E change reviews) ──────────────────────── */

const DECISION_LABEL: Record<ChangeReviewDecision, string> = { accept: "Accept", reject: "Reject", investigate: "Investigate" };

function ChangesSection({ view, pending, dispatch }: { view: DemoView; pending: boolean; dispatch: Dispatch }) {
  const open = openChanges(view.changes);
  const decided = view.changes.length - open.length;
  return (
    <section aria-labelledby="demo-changes" className="space-y-4">
      <div>
        <h3 id="demo-changes" className="type-section-title">
          A source changed after publishing
        </h3>
        <p className="text-sm text-muted-foreground">
          Priya uploaded a newer version of the infrastructure notes. Baton compared it with the published version and found what changed. Nothing changes
          by itself: each change needs Priya&rsquo;s decision before the next version can be published.
          {decided > 0 && ` ${decided} of ${view.changes.length} decided.`}
        </p>
      </div>
      {open.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success-fg">
          <CheckCircle2 aria-hidden="true" className="size-4" />
          Every change is decided.
        </p>
      ) : (
        <ul className="space-y-4">
          {open.map((item) => (
            <li key={item.id}>
              <ChangeDecisionCard item={item} handoverId={view.handover.id} pending={pending} dispatch={dispatch} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeDecisionCard({ item, handoverId, pending, dispatch }: { item: ChangeReviewItem; handoverId: string; pending: boolean; dispatch: Dispatch }) {
  const t = changeReviewKindText[item.kind];
  const [decision, setDecision] = useState<ChangeReviewDecision | null>(null);
  const [note, setNote] = useState("");
  const [statement, setStatement] = useState(item.point?.statement ?? "");
  const noteId = `change-note-${item.id}`;
  const statementId = `change-statement-${item.id}`;
  const label = (d: ChangeReviewDecision) => (d === "accept" ? t.accept : d === "reject" ? t.reject : DECISION_LABEL[d]);
  const help = decision === "accept" ? t.acceptHelp : decision === "reject" ? t.rejectHelp : decision === "investigate" ? "Keep it open with a note while you check. It still blocks publishing." : null;

  function submit() {
    if (!decision) return;
    const input = changeDecisionInput(item, handoverId, decision, {
      note,
      correction: item.kind === "possible_contradiction" ? { title: item.point?.title ?? "", statement } : undefined,
    });
    if (!input) return;
    void dispatch(decideChangeReview(input), `${label(decision)}: recorded as Priya`).then((r) => {
      if (r.ok) {
        setDecision(null);
        setNote("");
      }
    });
  }

  return (
    <article className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="type-eyebrow text-muted-foreground">
        {t.label}
        {item.state === "investigating" && " · investigating"}
      </p>
      {item.point?.title && <h4 className="text-sm font-semibold"><MaskedText text={item.point.title} /></h4>}
      <p className="text-sm text-muted-foreground">{t.explain}</p>
      {item.newMessage && (
        <blockquote className="rounded-r-lg border-l-2 border-l-primary/40 bg-muted/45 px-3 py-2 text-sm">
          <MaskedText text={item.newMessage.body} />
          <footer className="mt-1 text-caption text-muted-foreground">
            {item.sourceTitle ?? "Updated source"} · version {item.toVersion}
          </footer>
        </blockquote>
      )}
      <fieldset>
        <legend className="text-sm font-medium">Your decision, as Priya</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["accept", "reject", "investigate"] as const).map((d) => (
            <Button key={d} type="button" size="sm" variant={decision === d ? "default" : "outline"} aria-pressed={decision === d} disabled={pending} onClick={() => setDecision(d)}>
              {label(d)}
            </Button>
          ))}
        </div>
      </fieldset>
      {decision && (
        <div className="space-y-3 rounded-lg bg-muted/40 p-3">
          {help && <p className="text-sm">{help}</p>}
          {decision === "accept" && item.kind === "possible_contradiction" && (
            <div className="space-y-1">
              <Label htmlFor={statementId}>Corrected point, in your words</Label>
              <Textarea id={statementId} rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} maxLength={2000} />
              <p className="text-caption text-muted-foreground">The new message above becomes its supporting quotation.</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={noteId}>{decision === "investigate" ? "What are you checking?" : decision === "reject" ? "Why?" : "Note (kept with the decision)"}</Label>
            <Textarea id={noteId} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={submit}>
              Save: {label(decision)}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
