"use client";

import { ChevronDown, Circle, CircleDashed, CircleHelp, Scale } from "lucide-react";
import { useState } from "react";

import { OutdatedBadge } from "@/components/handover/badges";
import { formatDate, formatDateTime, formatShortDate } from "@/components/handover/format";
import { categoryLabel } from "@/components/handover/labels";
import { EvidenceQuote } from "@/components/review/evidence-quote";
import { keyFacts, type KeyFact } from "@/components/shared/key-facts";
import { KeyFactsStrip } from "@/components/shared/key-facts-strip";
import { MaskedText } from "@/components/shared/masked-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";

import type { TimelineEntry, TimelineGroupKind } from "./build-timeline";

/** Key facts as the published view shows them, plus `recurring_problem.firstSeenAt` (free text, never parsed). */
function factsFor(entry: TimelineEntry): KeyFact[] {
  const facts = keyFacts(entry.category, entry.content.attributes);
  const firstSeen = (entry.content.attributes as { firstSeenAt?: unknown }).firstSeenAt;
  if (entry.category === "recurring_problem" && typeof firstSeen === "string" && firstSeen.trim()) {
    facts.push({ kind: "date", label: "First seen", value: firstSeen.trim(), tone: "neutral" });
  }
  return facts;
}

const dates = (list: string[]) => list.map(formatShortDate).join(", ");

/**
 * One point on the timeline. The marker carries its meaning in text too (the date, "No date", the conflict note),
 * never in colour or shape alone. Evidence is a lazy in-row disclosure, as in the published view.
 */
export function TimelineRow({ entry, group }: { entry: TimelineEntry; group: TimelineGroupKind }) {
  const c = entry.content;
  const conflict = entry.conflict;
  const Marker = group === "open_questions" ? CircleHelp : group === "undated" ? CircleDashed : conflict ? Scale : Circle;
  const source = entry.evidence.find((e) => e.stance === "supports" && e.sentAt === entry.anchorAt) ?? null;

  return (
    <li className="relative grid grid-cols-[1.375rem_minmax(0,1fr)] gap-x-3">
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-3 flex size-[1.375rem] items-center justify-center rounded-full border bg-background",
          conflict ? "border-status-conflicting/40 text-status-conflicting" : "border-border text-muted-foreground",
          group === "open_questions" && "border-dashed border-status-missing/45 text-status-missing-fg",
        )}
      >
        <Marker className={cn("size-3", group === "month" && !conflict && "fill-current")} />
      </span>

      <div
        className={cn(
          "min-w-0 rounded-xl border bg-card p-4 shadow-soft sm:px-5",
          conflict ? "border-status-conflicting/25" : "border-border",
          group === "open_questions" && "border-dashed border-status-missing/45 bg-status-missing-soft/50 shadow-none",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          {group === "month" && entry.anchorAt ? (
            <time dateTime={entry.anchorAt} title={formatDateTime(entry.anchorAt)} className="font-medium text-foreground tabular-nums">
              {formatShortDate(entry.anchorAt)}
            </time>
          ) : group === "undated" ? (
            <span className="font-medium">No date</span>
          ) : null}
          <span>{categoryLabel[entry.category]}</span>
          {c.evidenceStatus !== "sourced" && <StatusBadge status={c.evidenceStatus} size="sm" />}
          {c.isPotentiallyOutdated && <OutdatedBadge className="ml-auto" />}
        </div>

        <h4 className="mt-1 type-subheading [overflow-wrap:anywhere]">
          <MaskedText text={c.title} />
        </h4>
        <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-foreground/80 [overflow-wrap:anywhere]">
          <MaskedText text={c.statement} />
        </p>

        <KeyFactsStrip facts={factsFor(entry)} className="mt-2" />

        {(source || (entry.lastSeenAt && entry.lastSeenAt !== entry.anchorAt)) && (
          <p className="mt-2 flex flex-wrap gap-x-2 text-caption text-muted-foreground">
            {source && (
              <span className="min-w-0 [overflow-wrap:anywhere]">
                First said
                {source.authorLabel && (
                  <>
                    {" by "}
                    <MaskedText text={source.authorLabel} className="font-medium text-foreground/85" />
                  </>
                )}
                {source.sourceTitle && ` in ${source.sourceTitle}`}
              </span>
            )}
            {entry.lastSeenAt && entry.lastSeenAt !== entry.anchorAt && (
              <span>
                Last mentioned{" "}
                <time dateTime={entry.lastSeenAt} title={formatDateTime(entry.lastSeenAt)} className="tabular-nums">
                  {formatDate(entry.lastSeenAt)}
                </time>
              </span>
            )}
          </p>
        )}

        {conflict && <ConflictNote entry={entry} />}

        <EvidenceDisclosure entry={entry} />
      </div>
    </li>
  );
}

/** Berry status-conflicting tokens; the text says what disagrees and when, so colour is never the only signal. */
function ConflictNote({ entry }: { entry: TimelineEntry }) {
  const { supportsAt, contradictsAt } = entry.conflict!;
  const resolution = entry.content.conflictResolution;
  const when = [supportsAt.length > 0 && `Supported ${dates(supportsAt)}`, contradictsAt.length > 0 && `Contradicted ${dates(contradictsAt)}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-status-conflicting/20 bg-status-conflicting-soft/50 px-3 py-2 text-sm">
      <Scale aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-conflicting" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-status-conflicting-fg">Sources disagree</p>
        {when && <p className="text-caption text-muted-foreground">{when}</p>}
        {resolution && (
          <p>
            <span className="font-medium">
              {resolution.byLabel} decided on {formatDate(resolution.at)}:{" "}
            </span>
            <MaskedText text={resolution.note} />
          </p>
        )}
      </div>
    </div>
  );
}

function EvidenceDisclosure({ entry }: { entry: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const { evidence, redactedCount } = entry;
  if (evidence.length === 0 && redactedCount === 0 && !entry.content.evidenceRedacted) return null;
  const panelId = `timeline-evidence-${entry.id}`;
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 items-center gap-1 rounded-md text-caption font-medium text-primary-fg outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 max-sm:h-10"
      >
        <ChevronDown aria-hidden="true" className={cn("size-3.5 motion-safe:transition-transform motion-safe:duration-200", open && "rotate-180")} />
        {evidence.length === 0
          ? `${open ? "Hide" : "Show"} evidence notes`
          : `${open ? "Hide" : "Show"} ${evidence.length === 1 ? "the quote" : `${evidence.length} quotes`} behind this`}
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
          {(redactedCount > 0 || entry.content.evidenceRedacted) && (
            <p className="text-caption text-muted-foreground">Some evidence was removed at a participant&rsquo;s request.</p>
          )}
        </div>
      )}
    </div>
  );
}
