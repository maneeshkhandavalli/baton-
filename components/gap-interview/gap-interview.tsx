"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { categoryLabel } from "@/components/handover/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedText } from "@/components/shared/masked-text";
import { useAction } from "@/hooks/use-action";
import type { GapInterview as GapInterviewData } from "@/lib/contracts/dto";
import { submitGapAnswers } from "@/lib/mocks/actions";
import { cn } from "@/lib/utils";

interface Draft {
  name: string;
  answers: Record<string, string>;
}

const storageKey = (token: string) => `baton:gap-draft:${token.slice(0, 12)}`;

export function GapInterview({ token, data }: { token: string; data: GapInterviewData }) {
  const reduceMotion = useReducedMotion();
  const { run, isPending, error } = useAction();
  const [draft, setDraft] = useState<Draft>({ name: "", answers: {} });
  const [index, setIndex] = useState(-1); // -1 = intro, questions.length = review
  const [done, setDone] = useState<{ submitted: number; skipped: number } | null>(null);
  const qs = data.questions;

  // Restore an unsent draft (per-viewer convenience only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(token));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage after hydration
      if (raw) setDraft(JSON.parse(raw) as Draft);
    } catch {
      /* storage unavailable */
    }
  }, [token]);
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(token), JSON.stringify(draft));
    } catch {
      /* storage unavailable */
    }
  }, [draft, token]);

  const answered = qs.filter((q) => (draft.answers[q.id] ?? "").trim().length > 0);

  async function submit() {
    const result = await run(() =>
      submitGapAnswers({
        token,
        answererLabel: draft.name.trim(),
        answers: answered.map((q) => ({ gapQuestionId: q.id, answerText: draft.answers[q.id].trim() })),
      }),
    );
    if (result.ok) {
      setDone({ submitted: result.data.submitted, skipped: qs.length - answered.length });
      try {
        window.localStorage.removeItem(storageKey(token));
      } catch {
        /* storage unavailable */
      }
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-soft">
        <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-status-sourced" />
        <h2 className="mt-4 font-serif text-3xl">Thank you{draft.name ? `, ${draft.name.split(" ")[0]}` : ""}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {done.submitted} {done.submitted === 1 ? "answer was" : "answers were"} sent to the team. A reviewer will check each one before it becomes part of the handover.
          {done.skipped > 0 && ` ${done.skipped} skipped ${done.skipped === 1 ? "question stays" : "questions stay"} open; you can come back to this link until it expires.`}
        </p>
      </div>
    );
  }

  if (qs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-soft">
        <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-status-sourced" />
        <h2 className="mt-4 font-serif text-3xl">Nothing left to answer</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Every question on this link has been answered. Thanks for helping the next person.</p>
      </div>
    );
  }

  const q = index >= 0 && index < qs.length ? qs[index] : null;
  const progress = Math.round(((index < 0 ? 0 : index) / qs.length) * 100);

  return (
    <div className="space-y-6">
      {index >= 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{index < qs.length ? `Question ${index + 1} of ${qs.length}` : "Review your answers"}</span>
            <span>{answered.length} answered</span>
          </div>
          <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={index >= qs.length ? 100 : progress} className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${index >= qs.length ? 100 : progress}%` }} />
          </div>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={index}
          initial={reduceMotion ? false : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: -8 }}
          transition={{ duration: 0.2 }}
          className="rounded-xl border border-border bg-card p-5 shadow-soft sm:p-7"
        >
          {index === -1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  The team preparing <span className="font-medium text-foreground">{data.handoverTitle}</span> has {qs.length} {qs.length === 1 ? "question" : "questions"} their documents couldn&rsquo;t answer.
                  Answer what you can and skip the rest. It takes about {Math.max(2, qs.length * 2)} minutes.
                </p>
                <p className="flex items-start gap-2 rounded-lg bg-background/70 p-3 text-xs text-muted-foreground">
                  <ShieldCheck aria-hidden="true" className="mt-px size-4 shrink-0 text-status-sourced" />
                  Phone numbers, emails, payment details and passwords you type are masked automatically. Please don&rsquo;t share passwords; say where they are kept instead.
                </p>
              </div>
              <div className="max-w-sm space-y-1.5">
                <Label htmlFor="answerer">Your name</Label>
                <Input id="answerer" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="So the team knows who answered" aria-invalid={!!error?.fieldErrors?.answererLabel} />
                {error?.fieldErrors?.answererLabel && <p className="text-xs text-destructive">{error.fieldErrors.answererLabel[0]}</p>}
              </div>
              <Button size="lg" disabled={!draft.name.trim()} onClick={() => setIndex(0)}>
                Start
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            </div>
          )}

          {q && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[0.6875rem] font-medium", q.priority === "required" ? "bg-status-conflicting-soft text-status-conflicting-fg" : "bg-muted text-muted-foreground")}>
                  {q.priority === "required" ? "Important" : "Optional"}
                </span>
                {q.category && <span className="text-xs text-muted-foreground">{categoryLabel[q.category]}</span>}
              </div>
              <h2 className="font-serif text-2xl leading-snug sm:text-3xl"><MaskedText text={q.question} /></h2>
              {q.context && <p className="text-sm text-muted-foreground"><MaskedText text={q.context} /></p>}
              <Label htmlFor={`a-${q.id}`} className="sr-only">
                Your answer
              </Label>
              <Textarea
                id={`a-${q.id}`}
                autoFocus
                rows={5}
                maxLength={4000}
                value={draft.answers[q.id] ?? ""}
                onChange={(e) => setDraft({ ...draft, answers: { ...draft.answers, [q.id]: e.target.value } })}
                placeholder="Write what you know. Names, where things are kept, and who to ask are all helpful."
                className="min-h-32"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => setIndex(index - 1)}>
                  <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                  Back
                </Button>
                <div className="flex gap-2">
                  {!(draft.answers[q.id] ?? "").trim() && (
                    <Button variant="outline" onClick={() => setIndex(index + 1)}>
                      Skip
                    </Button>
                  )}
                  <Button disabled={!(draft.answers[q.id] ?? "").trim()} onClick={() => setIndex(index + 1)}>
                    {index === qs.length - 1 ? "Review" : "Next"}
                    <ArrowRight aria-hidden="true" data-icon="inline-end" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {index === qs.length && (
            <div className="space-y-5">
              <h2 className="font-serif text-2xl">Review and send</h2>
              <ol className="space-y-3">
                {qs.map((x, i) => {
                  const a = (draft.answers[x.id] ?? "").trim();
                  return (
                    <li key={x.id} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium">{x.question}</p>
                      <p className={cn("mt-1 text-sm whitespace-pre-line", a ? "text-foreground/85" : "text-muted-foreground italic")}>{a || "Skipped"}</p>
                      <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setIndex(i)}>
                        {a ? "Edit" : "Answer"}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => setIndex(qs.length - 1)}>
                  <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                  Back
                </Button>
                <Button size="lg" disabled={answered.length === 0 || isPending || !draft.name.trim()} onClick={submit}>
                  {isPending ? "Sending…" : `Send ${answered.length} ${answered.length === 1 ? "answer" : "answers"}`}
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
