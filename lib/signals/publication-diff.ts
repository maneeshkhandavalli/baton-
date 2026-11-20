/**
 * Round 4 B (audit E2): "What changed since vN". A pure comparison of two published snapshots of the same handover,
 * as the viewer may read them (both come through RLS, so a point outside the viewer's clearance is in neither and
 * never shows up as added or removed). Points are matched by their stable point id.
 */

import type { EvidenceStatus, PointCategory } from "../contracts/enums";
import type { PublishedHandover, PublishedPointContent } from "../contracts/dto";

export type PointChangeKind = "added" | "removed" | "reworded" | "status" | "became_gap" | "gap_answered";

export interface PublicationPointChange {
  pointId: string;
  category: PointCategory;
  /** Title in the newer version (or the older one for a removed point). Masked text: render with MaskedText. */
  title: string;
  previousTitle: string | null;
  kinds: PointChangeKind[];
  fromStatus: EvidenceStatus | null;
  toStatus: EvidenceStatus | null;
}

export interface PublicationDiff {
  fromVersion: number;
  toVersion: number;
  fromPublishedAt: string;
  toPublishedAt: string;
  added: PublicationPointChange[];
  removed: PublicationPointChange[];
  changed: PublicationPointChange[];
  unchangedCount: number;
}

type Flat = { id: string; category: PointCategory; content: PublishedPointContent };

function flatten(h: PublishedHandover): Map<string, Flat> {
  const out = new Map<string, Flat>();
  for (const s of h.sections) for (const p of s.points) out.set(p.id, { id: p.id, category: s.category, content: p.content });
  return out;
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** `previous` must be the older version. */
export function diffPublications(previous: PublishedHandover, current: PublishedHandover): PublicationDiff {
  const before = flatten(previous);
  const after = flatten(current);
  const added: PublicationPointChange[] = [];
  const removed: PublicationPointChange[] = [];
  const changed: PublicationPointChange[] = [];
  let unchangedCount = 0;

  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) {
      added.push({ pointId: id, category: now.category, title: now.content.title, previousTitle: null, kinds: ["added"], fromStatus: null, toStatus: now.content.evidenceStatus });
      continue;
    }
    const kinds: PointChangeKind[] = [];
    const a = was.content;
    const b = now.content;
    if (a.title !== b.title || a.statement !== b.statement || stableJson(a.attributes) !== stableJson(b.attributes)) kinds.push("reworded");
    if (!a.isKnownGap && b.isKnownGap) kinds.push("became_gap");
    else if (a.isKnownGap && !b.isKnownGap) kinds.push("gap_answered");
    else if (a.evidenceStatus !== b.evidenceStatus) kinds.push("status");
    if (kinds.length === 0) {
      unchangedCount += 1;
      continue;
    }
    changed.push({ pointId: id, category: now.category, title: b.title, previousTitle: a.title !== b.title ? a.title : null, kinds, fromStatus: a.evidenceStatus, toStatus: b.evidenceStatus });
  }
  for (const [id, was] of before) {
    if (after.has(id)) continue;
    removed.push({ pointId: id, category: was.category, title: was.content.title, previousTitle: null, kinds: ["removed"], fromStatus: was.content.evidenceStatus, toStatus: null });
  }
  return {
    fromVersion: previous.version,
    toVersion: current.version,
    fromPublishedAt: previous.publishedAt,
    toPublishedAt: current.publishedAt,
    added,
    removed,
    changed,
    unchangedCount,
  };
}

export function hasChanges(d: PublicationDiff): boolean {
  return d.added.length + d.removed.length + d.changed.length > 0;
}
