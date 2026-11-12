"use client";

import { CheckCircle2, ChevronDown, CircleHelp, Lightbulb, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { OutdatedBadge } from "@/components/handover/badges";
import { attributeRows } from "@/components/handover/attributes";
import { formatDate } from "@/components/handover/format";
import { HANDOVER_SECTIONS, categoryLabel, memberRoleLabel } from "@/components/handover/labels";
import { EvidenceQuote } from "@/components/review/evidence-quote";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { MaskedText } from "@/components/shared/masked-text";
import { useAction } from "@/hooks/use-action";
import type { PublishedHandover, PublishedPointContent } from "@/lib/contracts/dto";
import type { MemberRole, PointCategory } from "@/lib/contracts/enums";
import { acknowledgePublication } from "@/lib/actions/members";
import { cn } from "@/lib/utils";

import { buildFirstWeek } from "./first-week";

/** Version of the acknowledgement statement shown below (acknowledgePublication.statementVersion). */
export const ACK_STATEMENT_VERSION = "2026-11-ack-v1";

interface PublishedHandoverViewProps {
  handover: PublishedHandover;
  viewerLabel: string;
  viewerRole: MemberRole;
  /** Turns off acknowledgement (e.g. the public demo or a reviewer preview). */
  preview?: boolean;
}

type Point = { id: string; content: PublishedPointContent; category: PointCategory };

export function PublishedHandoverView({ handover, viewerLabel, viewerRole, preview = false }: PublishedHandoverViewProps) {
  const points: Point[] = handover.sections.flatMap((s) => s.points.map((p) => ({ ...p, category: s.category })));
  const facts = points.filter((p) => !p.content.isKnownGap);
  const gaps = points.filter((p) => p.content.isKnownGap);
  const groups = HANDOVER_SECTIONS.map((s) => ({ ...s, points: facts.filter((p) => (s.categories as readonly PointCategory[]).includes(p.category)) })).filter((g) => g.points.length > 0);
  const inferredCount = facts.filter((p) => p.content.evidenceStatus === "inferred").length;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="On this page" className="hidden lg:block">
        <ul className="sticky top-6 space-y-1 text-sm">
          <li>
            <a href="#first-week" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              First 7 days
            </a>
          </li>
          {groups.map((g) => (
            <li key={g.id}>
              <a href={`#${g.id}`} className="flex justify-between rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                {g.label}
                <span className="font-mono text-xs">{g.points.length}</span>
              </a>
            </li>
          ))}
          {gaps.length > 0 && (
            <li>
              <a href="#open-questions" className="flex justify-between rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                Open questions
                <span className="font-mono text-xs">{gaps.length}</span>
              </a>
            </li>
          )}
          <li>
            <a href="#acknowledge" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              Acknowledge
            </a>
          </li>
        </ul>
      </nav>

      <div className="min-w-0 space-y-12">
        <header className="space-y-4 border-b border-border pb-8">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {handover.teamName}
            {handover.roleTitle && ` · ${handover.roleTitle}`}
          </p>
          <h1 className="font-serif text-4xl leading-[1.08] tracking-tight text-balance sm:text-5xl">{handover.title}</h1>
          <p className="text-sm text-muted-foreground">
            Version {handover.version} · published {formatDate(handover.publishedAt)} by {handover.publishedByLabel} · reading as {viewerLabel} ({memberRoleLabel[viewerRole].toLowerCase()})
          </p>
          {handover.summary && <p className="max-w-2xl text-lg leading-relaxed text-pretty"><MaskedText text={handover.summary} /></p>}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <StatusBadge status="sourced" size="sm" /> backed by a quote you can check
            </span>
            {inferredCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <StatusBadge status="inferred" size="sm" /> not stated outright; confirmed by a reviewer
              </span>
            )}
          </div>
        </header>

        <FirstWeek handover={handover} />

        {groups.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className="scroll-mt-6 space-y-4">
            <h2 id={`${g.id}-h`} className="font-serif text-3xl tracking-tight">
              {g.label}
            </h2>
            <ul className="space-y-3">
              {g.points.map((p) => (
                <li key={p.id}>
                  <PublishedPoint point={p} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {gaps.length > 0 && (
          <section id="open-questions" aria-labelledby="oq-h" className="scroll-mt-6 space-y-4">
            <div>
              <h2 id="oq-h" className="font-serif text-3xl tracking-tight">
                Open questions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Known gaps. Nobody could answer these before the handover, so treat them as things to find out, not facts.</p>
            </div>
            <ul className="space-y-2">
              {gaps.map((p) => (
                <li key={p.id} className="flex items-start gap-3 rounded-xl border border-dashed border-border-strong bg-status-missing-soft/40 p-4">
                  <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-missing-fg" />
                  <div>
                    <p className="text-sm font-medium"><MaskedText text={p.content.title} /></p>
                    <p className="text-sm text-muted-foreground"><MaskedText text={p.content.statement} /></p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Acknowledge handover={handover} viewerRole={viewerRole} preview={preview} />
      </div>
    </div>
  );
}

function PublishedPoint({ point }: { point: Point }) {
  const [open, setOpen] = useState(false);
  const c = point.content;
  const rows = attributeRows(point.category, c.attributes);
  const evidence = c.evidence.filter((e) => !e.redacted);
  const redacted = c.evidence.length - evidence.length;

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={c.evidenceStatus} size="sm" />
        <span className="text-xs text-muted-foreground">{categoryLabel[point.category]}</span>
        {c.isPotentiallyOutdated && <OutdatedBadge className="ml-auto" />}
      </div>
      <h3 className="mt-2 text-base leading-snug font-semibold"><MaskedText text={c.title} /></h3>
      <p className="mt-1 text-sm leading-relaxed text-foreground/80"><MaskedText text={c.statement} /></p>

      {rows.length > 0 && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {c.evidenceStatus === "inferred" && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-status-inferred-soft px-3 py-2 text-sm text-status-inferred-fg">
          <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            No source states this outright.
            {c.inferredConfirmation ? ` Confirmed by ${c.inferredConfirmation.byLabel} on ${formatDate(c.inferredConfirmation.at)}.` : " Treat it as unconfirmed."}
          </span>
        </p>
      )}
      {c.conflictResolution && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
          <Scale aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-conflicting" />
          <span>
            <span className="font-medium">Sources disagreed. {c.conflictResolution.byLabel} resolved it: </span>
            <MaskedText text={c.conflictResolution.note} />
          </span>
        </p>
      )}

      {(evidence.length > 0 || redacted > 0) && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            {open ? "Hide" : "Show"} {evidence.length} {evidence.length === 1 ? "source" : "sources"}
          </button>
          {open && (
            <div className="mt-2 space-y-2">
              {evidence.map((e) =>
                e.redacted ? null : (
                  <EvidenceQuote key={e.evidenceId} quote={e.quote} kind={e.kind} authorLabel={e.authorLabel} sentAt={e.sentAt} sourceTitle={e.sourceTitle} tone={e.stance === "contradicts" ? "contradicts" : "supports"} />
                ),
              )}
              {redacted > 0 && <p className="text-xs text-muted-foreground">Some evidence was removed at a participant&rsquo;s request.</p>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function FirstWeek({ handover }: { handover: PublishedHandover }) {
  const days = useMemo(() => buildFirstWeek(handover), [handover]);
  const key = `baton:first-week:${handover.publicationId}`;
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage after hydration
      if (raw) setDone(JSON.parse(raw) as string[]);
    } catch {
      /* storage unavailable */
    }
  }, [key]);

  function toggle(id: string) {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }

  const total = days.reduce((n, d) => n + d.items.length, 0);
  const completed = days.reduce((n, d) => n + d.items.filter((i) => done.includes(i.id)).length, 0);
  if (total === 0) return null;

  return (
    <section id="first-week" aria-labelledby="fw-h" className="scroll-mt-6 rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="fw-h" className="font-serif text-3xl tracking-tight">
            Your first 7 days
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Built from the handover. Your progress is saved on this device.</p>
        </div>
        <p className="font-mono text-sm tabular-nums" aria-live="polite">
          {completed}/{total} done
        </p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-status-sourced transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(completed / total) * 100}%` }} />
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {days.map((d) => (
          <div key={d.label}>
            <h3 className="mb-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{d.label}</h3>
            <ul className="space-y-2">
              {d.items.map((item) => {
                const checked = done.includes(item.id);
                return (
                  <li key={item.id}>
                    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-2.5 text-sm transition-colors hover:bg-background/70", checked && "bg-status-sourced-soft/50")}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(item.id)} className="mt-0.5 size-4 shrink-0 accent-[var(--status-sourced)]" />
                      <span className="min-w-0">
                        <span className={cn("block leading-snug", checked && "text-muted-foreground line-through")}>{item.title}</span>
                        {item.detail && <span className="block text-xs text-muted-foreground">{item.detail}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Acknowledge({ handover, viewerRole, preview }: { handover: PublishedHandover; viewerRole: MemberRole; preview: boolean }) {
  const { run, isPending } = useAction();
  const [agreed, setAgreed] = useState(false);
  const acked = handover.viewerAcknowledgedAt;

  return (
    <section id="acknowledge" aria-labelledby="ack-h" className="scroll-mt-6 rounded-2xl border border-border bg-foreground p-6 text-background sm:p-8">
      {acked ? (
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="mt-1 size-6 shrink-0 text-status-sourced" />
          <div>
            <h2 id="ack-h" className="font-serif text-3xl">
              You&rsquo;ve acknowledged this handover
            </h2>
            <p className="mt-1 text-sm text-background/70">On {formatDate(acked)}. If a new version is published, you&rsquo;ll be asked to acknowledge it again.</p>
          </div>
        </div>
      ) : viewerRole !== "incoming" || preview ? (
        <div>
          <h2 id="ack-h" className="font-serif text-3xl">
            Acknowledgement
          </h2>
          <p className="mt-1 text-sm text-background/70">
            {preview ? "In the real handover, the incoming member confirms here that they've read it." : "Only incoming members acknowledge a handover."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 id="ack-h" className="font-serif text-3xl">
            Acknowledge the handover
          </h2>
          <label className="flex items-start gap-3 text-sm leading-relaxed text-background/85">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--status-sourced)]" />
            I&rsquo;ve read this handover, including the open questions and inferred points, and I know who to ask about anything unclear.
          </label>
          <Button
            size="lg"
            className="bg-background text-foreground hover:bg-background/90"
            disabled={!agreed || isPending}
            onClick={() => run(() => acknowledgePublication({ publicationId: handover.publicationId, statementVersion: ACK_STATEMENT_VERSION }), { success: "Handover acknowledged. Welcome aboard." })}
          >
            {isPending ? "Saving…" : "Acknowledge"}
          </Button>
        </div>
      )}
    </section>
  );
}
