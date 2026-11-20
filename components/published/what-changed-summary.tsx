import { GitCompareArrows } from "lucide-react";

import { formatDate } from "@/components/handover/format";
import { categoryLabel } from "@/components/handover/labels";
import { MaskedText } from "@/components/shared/masked-text";
import type { EvidenceStatus } from "@/lib/contracts/enums";
import type { PointChangeKind, PublicationDiff, PublicationPointChange } from "@/lib/signals/publication-diff";
import { hasChanges } from "@/lib/signals/publication-diff";

const STATUS_WORD: Record<EvidenceStatus, string> = {
  sourced: "sourced",
  inferred: "inferred",
  conflicting: "conflicting",
  missing: "missing",
};

/** A short, plain description of one changed point. */
export function describeChange(c: PublicationPointChange): string {
  const parts: string[] = [];
  const kinds = new Set<PointChangeKind>(c.kinds);
  if (kinds.has("reworded")) parts.push("Wording updated");
  if (kinds.has("became_gap")) parts.push("Now an open question");
  if (kinds.has("gap_answered")) parts.push("Answered, no longer an open question");
  if (kinds.has("status") && c.fromStatus && c.toStatus) parts.push(`Evidence now ${STATUS_WORD[c.toStatus]} (was ${STATUS_WORD[c.fromStatus]})`);
  return parts.join(" · ");
}

/** Plain-text headline, also used by tests. */
export function changeHeadline(d: PublicationDiff): string {
  const bits: string[] = [];
  if (d.added.length) bits.push(`${d.added.length} new`);
  if (d.changed.length) bits.push(`${d.changed.length} changed`);
  if (d.removed.length) bits.push(`${d.removed.length} removed`);
  if (bits.length === 0) return `No points changed since version ${d.fromVersion}.`;
  return `${bits.join(", ")} since version ${d.fromVersion}. ${d.unchangedCount} unchanged.`;
}

function ChangeList({ title, items, describe }: { title: string; items: PublicationPointChange[]; describe?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {title} <span className="type-numeric text-caption text-muted-foreground">{items.length}</span>
      </h3>
      <ul className="space-y-1.5 text-sm">
        {items.map((c) => (
          <li key={c.pointId} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
            <span className="text-caption text-muted-foreground sm:w-32 sm:shrink-0">{categoryLabel[c.category]}</span>
            <span className="min-w-0">
              <MaskedText text={c.title} />
              {c.previousTitle ? (
                <span className="text-muted-foreground">
                  {" "}
                  (was <MaskedText text={c.previousTitle} />)
                </span>
              ) : null}
              {describe ? <span className="block text-caption text-muted-foreground">{describeChange(c)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Round 4 B (audit E2): "What changed since vN", dated, shown above the handover so an incoming member reads it
 * before acknowledging the new version. Both versions are read through RLS, so it never mentions a point the viewer
 * cannot read.
 */
export function WhatChangedSummary({ diff, awaitingAcknowledgement }: { diff: PublicationDiff; awaitingAcknowledgement: boolean }) {
  return (
    <section aria-labelledby="what-changed-heading" className="rounded-2xl border border-border bg-card p-5" data-testid="what-changed">
      <div className="flex items-start gap-3">
        <GitCompareArrows className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <h2 id="what-changed-heading" className="type-subheading">
            What changed since version {diff.fromVersion}
          </h2>
          <p className="text-sm text-muted-foreground">
            Version {diff.fromVersion} was published on {formatDate(diff.fromPublishedAt)}; version {diff.toVersion} on {formatDate(diff.toPublishedAt)}.{" "}
            {changeHeadline(diff)}
          </p>
          {awaitingAcknowledgement ? (
            <p className="text-sm font-medium">Read these changes before you acknowledge version {diff.toVersion}.</p>
          ) : null}
        </div>
      </div>
      {hasChanges(diff) ? (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <ChangeList title="New" items={diff.added} />
          <ChangeList title="Changed" items={diff.changed} describe />
          <ChangeList title="No longer in the handover" items={diff.removed} />
        </div>
      ) : null}
    </section>
  );
}
