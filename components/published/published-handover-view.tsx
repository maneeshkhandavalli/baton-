"use client";

import { CheckCircle2, ChevronDown, CircleHelp, Lightbulb, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { OutdatedBadge } from "@/components/handover/badges";
import { attributeRows } from "@/components/handover/attributes";
import { formatDate } from "@/components/handover/format";
import { HANDOVER_SECTIONS, categoryLabel, memberRoleLabel } from "@/components/handover/labels";
import { EvidenceQuote } from "@/components/review/evidence-quote";
import { KEY_FACT_LABELS, keyFacts } from "@/components/shared/key-facts";
import { KeyFactsStrip } from "@/components/shared/key-facts-strip";
import { MaskedText } from "@/components/shared/masked-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
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
  /** Dev-only design preview: show the incoming member's real acknowledgement form, with the button disabled. */
  ackDisabledReason?: string;
}

type Point = { id: string; content: PublishedPointContent; category: PointCategory };

/**
 * Rendered under the page's own h1 (handover header or demo title), so the document title is an h2,
 * sections h3 and points h4.
 *
 * The handover as the incoming member reads it: an editorial document. Summary and "at a glance"
 * first, then the first-week checklist (what to do), then the sections (what to know), open
 * questions (what nobody knew) and the acknowledgement.
 */
export function PublishedHandoverView({ handover, viewerLabel, viewerRole, preview = false, ackDisabledReason }: PublishedHandoverViewProps) {
  const points: Point[] = handover.sections.flatMap((s) => s.points.map((p) => ({ ...p, category: s.category })));
  const facts = points.filter((p) => !p.content.isKnownGap);
  const gaps = points.filter((p) => p.content.isKnownGap);
  const groups = HANDOVER_SECTIONS.map((s) => ({ ...s, points: facts.filter((p) => (s.categories as readonly PointCategory[]).includes(p.category)) })).filter(
    (g) => g.points.length > 0,
  );
  const inferredCount = facts.filter((p) => p.content.evidenceStatus === "inferred").length;

  const toc = [
    { id: "first-week", label: "First 7 days", count: null as number | null },
    ...groups.map((g) => ({ id: g.id, label: g.label, count: g.points.length as number | null })),
    ...(gaps.length > 0 ? [{ id: "open-questions", label: "Open questions", count: gaps.length }] : []),
    { id: "acknowledge", label: "Acknowledge", count: null },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] xl:gap-14">
      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-6 space-y-3">
          <p className="type-eyebrow px-2 text-muted-foreground">On this page</p>
          <ul className="space-y-0.5 text-sm">
            {toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="flex justify-between gap-2 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t.label}
                  {t.count !== null && <span className="type-numeric text-xs">{t.count}</span>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <article className="min-w-0 space-y-14">
        <header className="space-y-6 border-b border-border pb-10">
          <div className="space-y-3">
            <p className="type-eyebrow text-muted-foreground">
              {handover.teamName}
              {handover.roleTitle && ` · ${handover.roleTitle}`}
            </p>
            <h2 className="type-page-title break-words">{handover.title}</h2>
            <p className="text-caption text-muted-foreground">
              Version {handover.version} · published {formatDate(handover.publishedAt)} by {handover.publishedByLabel} · reading as {viewerLabel} (
              {memberRoleLabel[viewerRole].toLowerCase()})
            </p>
          </div>
          {handover.summary && (
            <p className="max-w-2xl type-body-lg text-foreground">
              <MaskedText text={handover.summary} />
            </p>
          )}

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            {[
              ...groups.slice(0, 3).map((g) => ({ id: g.id, label: g.label, value: g.points.length })),
              { id: "open-questions", label: "Open questions", value: gaps.length },
            ].map((s) => (
              <div key={s.id} className="bg-card px-4 py-3">
                <dt className="type-eyebrow text-muted-foreground">{s.label}</dt>
                <dd className="mt-1 font-display text-3xl leading-none tabular-nums">
                  {s.value > 0 ? (
                    <a href={`#${s.id}`} className="rounded-sm hover:text-primary-fg">
                      {s.value}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-caption text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <StatusBadge status="sourced" size="sm" /> backed by a quote you can check
            </span>
            {inferredCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <StatusBadge status="inferred" size="sm" /> not stated outright; confirmed by a reviewer
              </span>
            )}
          </div>

          {/* Small screens: jump links instead of the sidebar */}
          <nav aria-label="Jump to section" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden">
            <ul className="flex gap-2">
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 max-sm:h-10 text-xs font-medium whitespace-nowrap text-muted-foreground hover:text-foreground">
                    {t.label}
                    {t.count !== null && <span className="tabular-nums">{t.count}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <FirstWeek handover={handover} />

        {groups.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className="space-y-5">
            <h3 id={`${g.id}-h`} className="type-section-title">
              {g.label}
              <span className="ml-3 align-middle font-sans text-sm text-muted-foreground tabular-nums">{g.points.length}</span>
            </h3>
            {g.id === "open_work" && <OpenWorkSummary points={g.points} />}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
              {g.points.map((p) => (
                <li key={p.id}>
                  <PublishedPoint point={p} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {gaps.length > 0 && (
          <section id="open-questions" aria-labelledby="oq-h" className="space-y-5">
            <div className="space-y-1.5">
              <h3 id="oq-h" className="type-section-title">
                Open questions
              </h3>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Known gaps. Nobody could answer these before the handover, so treat them as things to find out, not facts.
              </p>
            </div>
            <ul className="divide-y divide-dashed divide-status-missing/30 overflow-hidden rounded-xl border border-dashed border-status-missing/45 bg-status-missing-soft/50">
              {gaps.map((p) => (
                <li key={p.id} className="flex items-start gap-3 p-4 sm:px-5">
                  <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-missing-fg" />
                  <div className="min-w-0">
                    <p className="type-subheading">
                      <MaskedText text={p.content.title} />
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      <MaskedText text={p.content.statement} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Acknowledge handover={handover} viewerRole={viewerRole} preview={preview} disabledReason={ackDisabledReason} />
      </article>
    </div>
  );
}

/** "5 action items · 2 unassigned · 1 without a date" — what needs picking up first. */
function OpenWorkSummary({ points }: { points: Point[] }) {
  const facts = points.map((p) => keyFacts(p.category, p.content.attributes));
  const unassigned = facts.filter((f) => f.some((x) => x.kind === "person" && x.tone === "warning")).length;
  const undated = facts.filter((f) => f.some((x) => x.kind === "date" && x.value === "No date")).length;
  return (
    <p className="-mt-2 text-sm text-muted-foreground">
      {points.length} {points.length === 1 ? "item" : "items"} to pick up
      {unassigned > 0 && <span className="font-medium text-warning-fg"> · {unassigned} unassigned</span>}
      {undated > 0 && <span> · {undated} without a date</span>}
    </p>
  );
}

function PublishedPoint({ point }: { point: Point }) {
  const [open, setOpen] = useState(false);
  const c = point.content;
  const facts = keyFacts(point.category, c.attributes);
  // Facts already in the strip aren't repeated in the detail list.
  const rows = attributeRows(point.category, c.attributes).filter(([k]) => !KEY_FACT_LABELS.has(k));
  const evidence = c.evidence.filter((e) => !e.redacted);
  const redacted = c.evidence.length - evidence.length;
  const panelId = `evidence-${point.id}`;

  return (
    <div className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-muted-foreground">{categoryLabel[point.category]}</span>
        {c.evidenceStatus !== "sourced" && <StatusBadge status={c.evidenceStatus} size="sm" />}
        {c.isPotentiallyOutdated && <OutdatedBadge className="ml-auto" />}
      </div>
      <h4 className="mt-1.5 type-heading [overflow-wrap:anywhere]">
        <MaskedText text={c.title} />
      </h4>
      <KeyFactsStrip facts={facts} className="mt-2" />
      <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-foreground/80 [overflow-wrap:anywhere]">
        <MaskedText text={c.statement} />
      </p>

      {rows.length > 0 && (
        <dl className="mt-3 grid max-w-2xl gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
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
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-status-conflicting/20 bg-status-conflicting-soft/50 px-3 py-2 text-sm">
          <Scale aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-conflicting" />
          <span>
            <span className="font-medium">Sources disagreed. {c.conflictResolution.byLabel} decided: </span>
            <MaskedText text={c.conflictResolution.note} />
          </span>
        </p>
      )}

      {(evidence.length > 0 || redacted > 0) && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
            className="inline-flex h-8 items-center gap-1 rounded-md text-caption font-medium text-primary-fg max-sm:h-10 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
            {open ? "Hide" : "Show"} {evidence.length === 1 ? "the source" : `${evidence.length} sources`}
          </button>
          {open && (
            <div id={panelId} className="mt-2 space-y-2">
              {evidence.map((e) => (
                <EvidenceQuote
                  key={e.evidenceId}
                  quote={e.quote}
                  kind={e.kind}
                  authorLabel={e.authorLabel}
                  sentAt={e.sentAt}
                  sourceTitle={e.sourceTitle}
                  tone={e.stance === "contradicts" ? "contradicts" : "supports"}
                />
              ))}
              {redacted > 0 && <p className="text-caption text-muted-foreground">Some evidence was removed at a participant&rsquo;s request.</p>}
            </div>
          )}
        </div>
      )}
    </div>
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
    <section id="first-week" aria-labelledby="fw-h" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <h3 id="fw-h" className="type-section-title">
            Your first 7 days
          </h3>
          <p className="text-sm text-muted-foreground">Built from the handover. Ticks are saved on this device only.</p>
        </div>
        <p className="type-numeric text-sm" aria-live="polite">
          {completed}/{total} done
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="First-week progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${(completed / total) * 100}%` }} />
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-soft md:grid-cols-3">
        {days.map((d) => (
          <div key={d.label} className="bg-card p-4 sm:p-5">
            <h4 className="mb-3 type-eyebrow text-muted-foreground">{d.label}</h4>
            <ul className="space-y-1">
              {d.items.map((item) => {
                const checked = done.includes(item.id);
                return (
                  <li key={item.id}>
                    <label
                      className={cn(
                        "-mx-2 flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/60 has-focus-visible:ring-3 has-focus-visible:ring-ring/35",
                        checked && "text-muted-foreground",
                      )}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(item.id)} className="mt-0.5 size-4 shrink-0 accent-[var(--success)] outline-none" />
                      <span className="min-w-0">
                        <span className={cn("block leading-snug", checked && "line-through")}>{item.title}</span>
                        {item.detail && <span className="mt-0.5 block text-caption text-muted-foreground">{item.detail}</span>}
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

function Acknowledge({ handover, viewerRole, preview, disabledReason }: { handover: PublishedHandover; viewerRole: MemberRole; preview: boolean; disabledReason?: string }) {
  const { run, isPending } = useAction();
  const [agreed, setAgreed] = useState(false);
  const acked = handover.viewerAcknowledgedAt;

  return (
    <section id="acknowledge" aria-labelledby="ack-h" className="rounded-2xl bg-inverse p-6 text-inverse-foreground sm:p-8">
      {acked ? (
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="mt-1 size-6 shrink-0 text-status-sourced" />
          <div>
            <h3 id="ack-h" className="type-section-title">
              You&rsquo;ve acknowledged this handover
            </h3>
            <p className="mt-1.5 text-sm text-inverse-muted">On {formatDate(acked)}. If a new version is published, you&rsquo;ll be asked to acknowledge it again.</p>
          </div>
        </div>
      ) : viewerRole !== "incoming" || preview ? (
        <div>
          <h3 id="ack-h" className="type-section-title">
            Acknowledgement
          </h3>
          <p className="mt-1.5 text-sm text-inverse-muted">
            {preview ? "In the real handover, the incoming member confirms here that they've read it." : "Only incoming members acknowledge a handover."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <h3 id="ack-h" className="type-section-title">
              Acknowledge the handover
            </h3>
            <p className="text-sm text-inverse-muted">This tells the outgoing team you have it. You can still come back and read it any time.</p>
          </div>
          <label className="flex max-w-2xl cursor-pointer items-start gap-3 text-sm leading-relaxed">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--status-sourced)]" />
            I&rsquo;ve read this handover, including the open questions and inferred points, and I know who to ask about anything unclear.
          </label>
          <Button
            size="lg"
            className="bg-inverse-foreground text-inverse hover:bg-inverse-foreground/90 focus-visible:ring-inverse-foreground/40"
            disabled={!agreed || isPending || !!disabledReason}
            aria-busy={isPending}
            onClick={() =>
              run(() => acknowledgePublication({ publicationId: handover.publicationId, statementVersion: ACK_STATEMENT_VERSION }), {
                success: "Handover acknowledged. Welcome aboard.",
              })
            }
          >
            {isPending ? "Saving…" : "Acknowledge handover"}
          </Button>
          {disabledReason && <p className="text-caption text-inverse-muted">{disabledReason}</p>}
        </div>
      )}
    </section>
  );
}
