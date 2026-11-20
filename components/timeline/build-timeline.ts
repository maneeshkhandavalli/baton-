/**
 * Decision timeline (docs/product/decision-timeline-plan.md): the published points in the order things happened.
 * A pure function of `PublishedHandover`, so the timeline shows exactly what the Published tab shows to the same
 * viewer (RLS by clearance, §8.4, §8.5). No dates are invented: a point without a dated supporting quote is
 * "Undated", and known gaps keep their own "Open questions" group, as in the published view. Category dates
 * (`open_task.dueDate`, and the free-text `decidedAt`, `byWhen`, `since`, `firstSeenAt`) are labels only (the
 * key-facts strip) and never order anything.
 */

import { formatMonthYear, monthKey } from "@/components/handover/format";
import { HANDOVER_SECTIONS, type HandoverSectionId } from "@/components/handover/labels";
import type { PublishedEvidenceItem, PublishedHandover, PublishedPointContent } from "@/lib/contracts/dto";
import type { PointCategory } from "@/lib/contracts/enums";

export type VisibleEvidence = Extract<PublishedEvidenceItem, { redacted: false }>;

export interface TimelineEntry {
  id: string;
  category: PointCategory;
  sectionId: HandoverSectionId;
  content: PublishedPointContent;
  /** Earliest `sentAt` of the non-redacted SUPPORTING evidence: when it was first said. Null = undated. */
  anchorAt: string | null;
  /** Latest such `sentAt` (equal to anchorAt for a single dated quote). */
  lastSeenAt: string | null;
  /** Non-redacted evidence only; redacted items never reach the UI (§5.5, §12.8). */
  evidence: VisibleEvidence[];
  /** Redacted items, counted for the "Some evidence was removed" note. */
  redactedCount: number;
  /** Sources disagree: the dated supporting and contradicting quotes (ascending, unique). Null when they agree. */
  conflict: { supportsAt: string[]; contradictsAt: string[] } | null;
}

export type TimelineGroupKind = "month" | "open_questions" | "undated";

export interface TimelineGroup {
  /** "2026-03", "open-questions" or "undated"; unique, usable in element ids. */
  key: string;
  kind: TimelineGroupKind;
  label: string;
  entries: TimelineEntry[];
}

export interface TimelineModel {
  groups: TimelineGroup[];
  total: number;
  /** Sections that have at least one entry, in HANDOVER_SECTIONS order, for the filter. */
  sections: Array<{ id: HandoverSectionId; label: string; count: number }>;
}

export type TimelineFilter = "all" | HandoverSectionId;

const SECTION_ORDER = new Map<PointCategory, number>(
  HANDOVER_SECTIONS.flatMap((s, i) => (s.categories as readonly PointCategory[]).map((c) => [c, i] as const)),
);

function sectionIdFor(category: PointCategory): HandoverSectionId {
  return HANDOVER_SECTIONS[SECTION_ORDER.get(category) ?? 0].id;
}

/** Valid, dated instants only, by time (never string order), oldest first, without duplicates. */
function datesOf(items: VisibleEvidence[]): string[] {
  const dated = items.filter((e) => e.sentAt && !Number.isNaN(Date.parse(e.sentAt))).map((e) => e.sentAt as string);
  return [...new Set(dated)].sort((a, b) => Date.parse(a) - Date.parse(b));
}

function toEntry(id: string, category: PointCategory, content: PublishedPointContent): TimelineEntry {
  const evidence = content.evidence.filter((e): e is VisibleEvidence => !e.redacted);
  const supportsAt = datesOf(evidence.filter((e) => e.stance === "supports"));
  const contradictsAt = datesOf(evidence.filter((e) => e.stance === "contradicts"));
  const disagrees = content.evidenceStatus === "conflicting" || evidence.some((e) => e.stance === "contradicts");
  return {
    id,
    category,
    sectionId: sectionIdFor(category),
    content,
    anchorAt: supportsAt[0] ?? null,
    lastSeenAt: supportsAt.at(-1) ?? null,
    evidence,
    redactedCount: content.evidence.length - evidence.length,
    conflict: disagrees ? { supportsAt, contradictsAt } : null,
  };
}

/** Anchor date ascending (undated last), then section order, then point id: a stable, total order. */
function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.anchorAt !== b.anchorAt) {
    if (a.anchorAt === null) return 1;
    if (b.anchorAt === null) return -1;
    const byTime = Date.parse(a.anchorAt) - Date.parse(b.anchorAt);
    if (byTime !== 0) return byTime;
  }
  const bySection = (SECTION_ORDER.get(a.category) ?? 0) - (SECTION_ORDER.get(b.category) ?? 0);
  if (bySection !== 0) return bySection;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildTimeline(handover: PublishedHandover): TimelineModel {
  const entries = handover.sections
    .flatMap((s) => s.points.map((p) => toEntry(p.id, s.category, p.content)))
    .sort(compareEntries);

  const months = new Map<string, TimelineGroup>();
  const openQuestions: TimelineEntry[] = [];
  const undated: TimelineEntry[] = [];
  for (const e of entries) {
    if (e.content.isKnownGap) {
      openQuestions.push(e);
      continue;
    }
    const key = monthKey(e.anchorAt);
    if (!key) {
      undated.push(e);
      continue;
    }
    let group = months.get(key);
    if (!group) {
      group = { key, kind: "month", label: formatMonthYear(e.anchorAt), entries: [] };
      months.set(key, group);
    }
    group.entries.push(e);
  }

  // Entries are sorted, so months arrive in order; sorting the keys again keeps that explicit.
  const groups: TimelineGroup[] = [...months.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (openQuestions.length > 0) groups.push({ key: "open-questions", kind: "open_questions", label: "Open questions", entries: openQuestions });
  if (undated.length > 0) groups.push({ key: "undated", kind: "undated", label: "Undated", entries: undated });

  const sections = HANDOVER_SECTIONS.map((s) => ({ id: s.id, label: s.label, count: entries.filter((e) => e.sectionId === s.id).length })).filter(
    (s) => s.count > 0,
  );
  return { groups, total: entries.length, sections };
}

/** The groups for one filter value; groups left empty by the filter are dropped. */
export function filterTimeline(model: TimelineModel, filter: TimelineFilter): TimelineGroup[] {
  if (filter === "all") return model.groups;
  return model.groups.map((g) => ({ ...g, entries: g.entries.filter((e) => e.sectionId === filter) })).filter((g) => g.entries.length > 0);
}
