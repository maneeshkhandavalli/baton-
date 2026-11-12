"use client";

import Link from "next/link";
import { Check, CircleHelp, Copy, ExternalLink, Link2, MessageSquarePlus, X } from "lucide-react";
import { useState } from "react";

import { formatDate, formatDateTime } from "@/components/handover/format";
import { accessLevelMeta, categoryLabel, gapPriorityLabel } from "@/components/handover/labels";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { MaskedText } from "@/components/shared/masked-text";
import { maskedTextToPlain } from "@/components/shared/mask-tokens";
import { useAction } from "@/hooks/use-action";
import type { CreatedLink, GapQuestionSummary, PointSummary } from "@/lib/contracts/dto";
import { ACCESS_LEVELS, POINT_CATEGORIES, type AccessLevel, type GapPriority, type PointCategory } from "@/lib/contracts/enums";
import { createGapInterviewLink, createGapQuestion, reviewGapAnswer } from "@/lib/actions/gaps";

import { linkLevelAtLeast, questionLevelAtLeast } from "./gap-access";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

interface GapsManagerProps {
  handoverId: string;
  questions: GapQuestionSummary[];
  points: PointSummary[];
  canManage: boolean;
}

export function GapsManager({ handoverId, questions, points, canManage }: GapsManagerProps) {
  const { run, isPending } = useAction();
  const [linkOpen, setLinkOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const pointById = new Map(points.map((p) => [p.id, p]));

  const needsReview = questions.filter((q) => q.answers.some((a) => a.status === "submitted"));
  const open = questions.filter((q) => q.status === "open" && !needsReview.includes(q));
  const closed = questions.filter((q) => !needsReview.includes(q) && !open.includes(q));
  const openRequired = open.filter((q) => q.priority === "required").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <dl className="grid grid-cols-3 gap-6">
          <Stat label="Open" value={open.length} hint={`${openRequired} required`} />
          <Stat label="To review" value={needsReview.length} hint="answers waiting" />
          <Stat label="Closed" value={closed.length} hint="accepted or waived" />
        </dl>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAskOpen(true)}>
              <MessageSquarePlus aria-hidden="true" data-icon="inline-start" />
              Add question
            </Button>
            <Button onClick={() => setLinkOpen(true)} disabled={open.length === 0}>
              <Link2 aria-hidden="true" data-icon="inline-start" />
              Create interview link
            </Button>
          </div>
        )}
      </div>

      {questions.length === 0 ? (
        <EmptyState icon={<CircleHelp />} title="No knowledge gaps" description="Every point has evidence. Missing knowledge found during processing, and questions you add, will appear here." />
      ) : (
        <>
          <Group title="Answers to review" description="Accepting an answer adds it as testimony evidence to the linked point." questions={needsReview} pointById={pointById} handoverId={handoverId} canManage={canManage} pending={isPending} run={run} />
          <Group title="Open questions" description="Waiting for the outgoing member or someone else who knows." questions={open} pointById={pointById} handoverId={handoverId} canManage={canManage} pending={isPending} run={run} />
          <Group title="Closed" questions={closed} pointById={pointById} handoverId={handoverId} canManage={canManage} pending={isPending} run={run} />
        </>
      )}

      {linkOpen && <LinkDialog handoverId={handoverId} questions={open} pointById={pointById} onClose={() => setLinkOpen(false)} />}
      {askOpen && <AskDialog handoverId={handoverId} points={points.filter((p) => p.evidenceStatus === "missing" && !questions.some((q) => q.pointId === p.id))} onClose={() => setAskOpen(false)} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-serif text-4xl tabular-nums">{value}</dd>
      <dd className="text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

function Group({
  title,
  description,
  questions,
  pointById,
  handoverId,
  canManage,
  pending,
  run,
}: {
  title: string;
  description?: string;
  questions: GapQuestionSummary[];
  pointById: Map<string, PointSummary>;
  handoverId: string;
  canManage: boolean;
  pending: boolean;
  run: ReturnType<typeof useAction>["run"];
}) {
  if (questions.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">· {questions.length}</span>
        </h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <ul className="space-y-3">
        {questions.map((q) => {
          const point = q.pointId ? pointById.get(q.pointId) : undefined;
          return (
            <li key={q.id} className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge shape="tag" size="sm" tone={q.priority === "required" ? "warning" : "neutral"}>
                  {gapPriorityLabel[q.priority]}
                </Badge>
                {q.category && <span className="text-xs text-muted-foreground">{categoryLabel[q.category]}</span>}
                <Badge size="sm" className="ml-auto capitalize" tone={q.status === "open" ? "primary" : q.status === "answered" ? "warning" : "neutral"} dot>
                  {q.status}
                </Badge>
              </div>
              <h3 className="mt-2.5 type-heading"><MaskedText text={q.question} /></h3>
              {q.context && <p className="mt-1 text-sm text-muted-foreground"><MaskedText text={q.context} /></p>}
              {point && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  Linked point:
                  <StatusBadge status={point.evidenceStatus} size="sm" />
                  <Link href={routes.handover.review(handoverId)} className="font-medium text-foreground hover:underline">
                    <MaskedText text={point.title} />
                  </Link>
                </p>
              )}
              {q.answers.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {q.answers.map((a) => (
                    <li key={a.id} className={cn("rounded-lg border-l-2 bg-muted/40 py-2.5 pr-3 pl-3", a.status === "accepted" ? "border-l-status-sourced" : a.status === "rejected" ? "border-l-border opacity-70" : "border-l-primary/50")}>
                      <p className="text-sm leading-relaxed"><MaskedText text={a.text} /></p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">{a.answererLabel}</span>
                        <span>{formatDateTime(a.createdAt)}</span>
                        <span className="capitalize">· {a.status}</span>
                        {a.status === "submitted" && canManage && (
                          <span className="ml-auto flex gap-1.5">
                            <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => reviewGapAnswer({ answerId: a.id, decision: "reject" }), { success: "Answer rejected; the question is open again" })}>
                              <X aria-hidden="true" data-icon="inline-start" />
                              Reject
                            </Button>
                            <Button size="xs" disabled={pending} onClick={() => run(() => reviewGapAnswer({ answerId: a.id, decision: "accept" }), { success: point ? "Accepted and added as evidence" : "Answer accepted" })}>
                              <Check aria-hidden="true" data-icon="inline-start" />
                              Accept
                            </Button>
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const rank = (l: AccessLevel) => ACCESS_LEVELS.indexOf(l);

function LinkDialog({ handoverId, questions, pointById, onClose }: { handoverId: string; questions: GapQuestionSummary[]; pointById: Map<string, PointSummary>; onClose: () => void }) {
  const { run, isPending, error } = useAction();
  const [selected, setSelected] = useState(() => questions.map((q) => q.id));
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);
  // A question is at least as restricted as its linked point (§8.4). Questions without a point default
  // to "everyone"; the server rejects the link if any is more restricted than the level chosen here.
  // Derived from linked points only; questions without one have a level this screen can't see (gap-access.ts).
  const { atLeast: floor, underivable } = linkLevelAtLeast(questions.filter((q) => selected.includes(q.id)), pointById);
  const [chosenLevel, setChosenLevel] = useState<AccessLevel>("everyone");
  const maxAccessLevel = rank(chosenLevel) < rank(floor) ? floor : chosenLevel;
  // The real action returns an absolute URL built from BATON_SITE_URL; the mock returns a path.
  const absolute = result ? new URL(result.url, window.location.origin).href : "";

  return (
    <Dialog open onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{result ? "Share this link" : "Create a Gap Interview link"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Copy it now: for security, Baton only shows a link once. Anyone with it can answer these questions without an account until it expires."
              : "The person answering doesn't need an account. They only see the questions you choose."}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={absolute} aria-label="Gap Interview link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(absolute);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? <Check aria-hidden="true" data-icon="inline-start" /> : <Copy aria-hidden="true" data-icon="inline-start" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires {formatDate(result.expiresAt)} · up to 20 uses · reveals questions up to {accessLevelMeta[maxAccessLevel].label.toLowerCase()}. You can revoke it in{" "}
              <Link href={`${routes.handover.settings(handoverId)}#links`} className="font-medium text-primary hover:underline">
                Settings
              </Link>
              .
            </p>
            <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Open it in a new tab
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="max-h-64 space-y-2 overflow-y-auto">
              <legend className="mb-1 text-sm font-medium">Questions</legend>
              {questions.map((q) => (
                <label key={q.id} className="flex items-start gap-2.5 rounded-lg border border-border p-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={selected.includes(q.id)}
                    onChange={() => setSelected((s) => (s.includes(q.id) ? s.filter((x) => x !== q.id) : [...s, q.id]))}
                  />
                  <span>
                    <MaskedText text={q.question} />
                    <span className="block text-xs text-muted-foreground">
                      {gapPriorityLabel[q.priority]}
                      {(() => {
                        const level = questionLevelAtLeast(q, pointById);
                        if (level === null) return " · level set when it was asked";
                        return level === "everyone" ? "" : ` · at least ${accessLevelMeta[level].label.toLowerCase()}`;
                      })()}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="link-level">Most restricted question it may show</Label>
                <NativeSelect
                  id="link-level"
                  value={maxAccessLevel}
                  onChange={(e) => setChosenLevel(e.target.value as AccessLevel)}
                  className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm"
                  aria-describedby="link-level-hint"
                >
                  {ACCESS_LEVELS.map((l) => (
                    <option key={l} value={l} disabled={rank(l) < rank(floor)}>
                      {accessLevelMeta[l].label}
                    </option>
                  ))}
                </NativeSelect>
                <p id="link-level-hint" className="text-xs text-muted-foreground">
                  {error?.fieldErrors?.maxAccessLevel?.[0] ??
                    (underivable > 0
                      ? `Raised to match linked points. ${underivable === 1 ? "1 question isn't" : `${underivable} questions aren't`} linked to a point; Baton checks ${underivable === 1 ? "its" : "their"} level when you create the link.`
                      : "Raised automatically to match the linked points.")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expiry">Expires after (days)</Label>
                <Input id="expiry" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))} />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button
              disabled={isPending || selected.length === 0}
              onClick={() => run(() => createGapInterviewLink({ handoverId, questionIds: selected, maxAccessLevel, expiresInDays: days }), { onSuccess: setResult })}
            >
              {isPending ? "Creating…" : "Create link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AskDialog({ handoverId, points, onClose }: { handoverId: string; points: PointSummary[]; onClose: () => void }) {
  const { run, isPending, error } = useAction();
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [priority, setPriority] = useState<GapPriority>("optional");
  const [pointId, setPointId] = useState("");
  const [category, setCategory] = useState<PointCategory | "">("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("everyone");

  return (
    <Dialog open onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a question</DialogTitle>
          <DialogDescription>Ask about anything the sources don&rsquo;t cover. Personal details in your text are masked.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="q">Question</Label>
            <Textarea id="q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Who should the incoming lead ask about…?" aria-invalid={!!error?.fieldErrors?.question} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctx">Context (optional)</Label>
            <Input id="ctx" value={context} onChange={(e) => setContext(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prio">Priority</Label>
              <NativeSelect id="prio" value={priority} onChange={(e) => setPriority(e.target.value as GapPriority)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm">
                <option value="optional">Optional</option>
                <option value="required">Required before publishing</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pt">Link to a missing point</Label>
              <NativeSelect id="pt" value={pointId} onChange={(e) => { setPointId(e.target.value); if (e.target.value) setCategory(""); }} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm">
                <option value="">None</option>
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {maskedTextToPlain(p.title)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat">Topic</Label>
              <NativeSelect
                id="cat"
                value={category}
                disabled={!!pointId}
                onChange={(e) => setCategory(e.target.value as PointCategory | "")}
                className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm disabled:opacity-60"
                title={pointId ? "A question about a point uses the point's topic" : undefined}
              >
                <option value="">{pointId ? "From the linked point" : "None"}</option>
                {POINT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ask-level">Who may see it</Label>
              <NativeSelect id="ask-level" value={accessLevel} onChange={(e) => setAccessLevel(e.target.value as AccessLevel)} className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm">
                {ACCESS_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {accessLevelMeta[l].label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {pointId && <p className="text-xs text-muted-foreground">If the point is more restricted, the question is raised to its level.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={isPending || question.trim().length === 0}
            onClick={() =>
              run(
                () =>
                  createGapQuestion({
                    handoverId,
                    question: question.trim(),
                    context: context.trim() || undefined,
                    priority,
                    accessLevel,
                    // A question about a point takes the point's category (createGapQuestionInput).
                    ...(pointId ? { pointId } : category ? { category } : {}),
                  }),
                {
                  success: "Question added",
                  onSuccess: onClose,
                },
              )
            }
          >
            {isPending ? "Adding…" : "Add question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
