/**
 * Dashboard model (UI3, shell plan §2.2). Pure: no React, no Next, no I/O. The page loads data through the existing
 * BatonQueries (or lib/mocks for previews) and passes it here; this module decides what needs the viewer, which group
 * a handover belongs to, what its next action is, and filters/searches rows. Covered by
 * components/dashboard/__tests__/model.test.ts.
 */

import type { GapQuestionSummary, HandoverSummary, MemberSummary, ProcessingStatus, ReadinessReport } from "@/lib/contracts/dto";
import type { HandoverState, MemberRole } from "@/lib/contracts/enums";

/** Where each kind of destination lives (each a function of the handover id). Production passes real routes; previews pass /preview/* routes. */
export interface DashboardLinks {
  review: (id: string) => string;
  processing: (id: string) => string;
  published: (id: string) => string;
  gaps: (id: string) => string;
  settings: (id: string) => string;
  draft: (id: string, step: number) => string;
  offers: (id: string) => string;
}

/** A draft the viewer manages: which wizard step is next (1-based) of how many. */
export interface DraftProgress {
  step: number;
  steps: readonly string[];
  sources: number;
}

/** Everything the dashboard knows about one handover. Only `summary` is required. */
export interface HandoverInput {
  summary: HandoverSummary;
  readiness?: ReadinessReport | null;
  processing?: ProcessingStatus | null;
  gaps?: GapQuestionSummary[] | null;
  members?: MemberSummary[] | null;
  draft?: DraftProgress | null;
}

export type Stage = "draft" | "processing" | "review" | "published" | "acknowledged";
export const STAGES: readonly { id: Stage; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "processing", label: "Processing" },
  { id: "review", label: "In review" },
  { id: "published", label: "Published" },
  { id: "acknowledged", label: "Acknowledged" },
];

export type Side = "preparing" | "receiving";

export type AttentionKind = "offer" | "failed" | "conflicts" | "review" | "gaps" | "publish" | "acknowledge" | "privacy";

export interface AttentionItem {
  kind: AttentionKind;
  /** Short label for the kind ("Conflicts", "Review"…). */
  label: string;
  /** Plain sentence with counts. */
  reason: string;
  cta: string;
  href: string;
  /** Lower = more urgent. */
  rank: number;
}

export type Health = "ok" | "attention" | "blocked" | "failed" | "running";

export interface DashboardRow {
  id: string;
  title: string;
  team: string;
  role: MemberRole;
  isCreator: boolean;
  side: Side;
  stage: Stage;
  /** One line under the title: the most useful fact about where this handover is. */
  status: string;
  health: Health;
  /** 0–1 progress for a mini meter where it means something (draft steps, review decisions), else null. */
  progress: number | null;
  progressLabel: string | null;
  people: { name: string; role: MemberRole }[];
  attention: AttentionItem[];
  cta: string;
  href: string;
  updatedAt: string;
}

const ROLE_LABEL: Record<MemberRole, string> = { outgoing: "Outgoing", incoming: "Incoming", lead: "Lead", reviewer: "Reviewer" };
export const roleLabel = (r: MemberRole) => ROLE_LABEL[r];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function stageOf(state: HandoverState): Stage {
  switch (state) {
    case "draft":
      return "draft";
    case "processing":
      return "processing";
    case "in_review":
      return "review";
    case "approved":
      return "published";
    case "acknowledged":
      return "acknowledged";
  }
}

export const isReviewRole = (r: MemberRole) => r === "outgoing" || r === "reviewer";

function blocker(readiness: ReadinessReport | null | undefined, kind: ReadinessReport["blockers"][number]["kind"]): number {
  return readiness?.blockers.find((b) => b.kind === kind)?.count ?? 0;
}

/** The pure core: what this handover is, what it needs from the viewer, and where its one action goes. */
export function classify(input: HandoverInput, links: DashboardLinks): DashboardRow {
  const h = input.summary;
  const stage = stageOf(h.state);
  const side: Side = isReviewRole(h.viewerRole) ? "preparing" : "receiving";
  const r = input.readiness ?? null;
  const attention: AttentionItem[] = [];
  const people = (input.members ?? []).filter((m) => !m.isViewer).map((m) => ({ name: m.displayName, role: m.role }));

  let status = "";
  let health: Health = "ok";
  let progress: number | null = null;
  let progressLabel: string | null = null;
  let cta = "Open";
  let href = side === "receiving" ? links.published(h.id) : links.review(h.id);

  // A creatorship offer addressed to the viewer always comes first.
  if (h.pendingCreatorTransfer && !h.viewerIsCreator) {
    attention.push({ kind: "offer", label: "Offer", reason: "You've been offered creatorship. Accept or decline it in settings.", cta: "Review offer", href: links.offers(h.id), rank: 0 });
  }

  if (stage === "draft") {
    const d = input.draft;
    if (d && side === "preparing") {
      const step = Math.min(Math.max(d.step, 1), d.steps.length);
      status = `Step ${step} of ${d.steps.length}: ${d.steps[step - 1]}`;
      progress = (step - 1) / d.steps.length;
      progressLabel = `${step - 1} of ${d.steps.length} steps done`;
      cta = "Continue";
      href = links.draft(h.id, step);
    } else if (h.viewerIsCreator) {
      const run = input.processing?.run ?? null;
      if (run && run.status === "failed") {
        // QA-UI3-D1: a failed run returns the handover to draft; say so instead of "not started yet".
        health = "failed";
        status = "Processing stopped before finishing";
        cta = "See what failed";
        href = links.processing(h.id);
        attention.push({ kind: "failed", label: "Processing failed", reason: "Baton couldn't finish reading the sources. Retry or remove the source that failed.", cta, href, rank: 1 });
      } else {
        status = run && run.status === "cancelled" ? "Processing cancelled · start again when ready" : "Sources added · not started yet";
        cta = "Continue setup";
        href = links.processing(h.id);
      }
    } else {
      status = "Being set up by the creator";
      href = links.processing(h.id);
    }
  } else if (stage === "processing") {
    const run = input.processing?.run ?? null;
    if (run && (run.status === "failed" || run.status === "cancelled")) {
      health = "failed";
      status = "Processing stopped before finishing";
      cta = "See what failed";
      href = links.processing(h.id);
      if (side === "preparing") {
        attention.push({ kind: "failed", label: "Processing failed", reason: "Baton couldn't finish reading the sources. Retry or remove the source that failed.", cta, href, rank: 1 });
      }
    } else {
      health = "running";
      const stages = run?.stages ?? [];
      const done = stages.filter((s) => s.status === "succeeded" || s.status === "partial").length;
      status = stages.length ? `Reading sources · stage ${Math.min(done + 1, stages.length)} of ${stages.length}` : "Reading sources";
      progress = stages.length ? done / stages.length : null;
      progressLabel = stages.length ? `${done} of ${stages.length} stages done` : null;
      cta = "View progress";
      href = links.processing(h.id);
    }
  } else if (stage === "review") {
    const pending = blocker(r, "pending_points");
    const conflicts = blocker(r, "unresolved_conflicts");
    const inferred = blocker(r, "unconfirmed_inferred");
    const gaps = blocker(r, "open_required_gaps");
    const privacy = blocker(r, "privacy_review_required");
    const openGaps = (input.gaps ?? []).filter((g) => g.status === "open").length;
    if (r) {
      const decided = r.counts.byReviewState.approved + r.counts.byReviewState.rejected;
      const total = decided + r.counts.byReviewState.pending;
      progress = total ? decided / total : null;
      progressLabel = total ? `${decided} of ${total} points decided` : null;
    }
    const bits = [pending && `${pending} to review`, conflicts && plural(conflicts, "conflict"), gaps && `${gaps} required gap${gaps === 1 ? "" : "s"} open`]
      .filter(Boolean)
      .join(" · ");
    status = bits || (r?.canPublish ? "Ready to publish" : "In review");
    health = conflicts || privacy ? "blocked" : bits ? "attention" : "ok";
    cta = side === "preparing" ? (r?.canPublish ? "Publish" : "Continue review") : "Open";
    href = links.review(h.id);
    if (side === "preparing") {
      if (conflicts) attention.push({ kind: "conflicts", label: "Conflicts", reason: `${plural(conflicts, "conflict")} where sources disagree. Decide what's true now.`, cta: "Resolve", href: links.review(h.id), rank: 2 });
      if (privacy) attention.push({ kind: "privacy", label: "Privacy", reason: `${plural(privacy, "point")} need a privacy check before publishing.`, cta: "Check", href: links.review(h.id), rank: 2 });
      if (pending || inferred) {
        const parts = [pending && `${plural(pending, "point")} awaiting a decision`, inferred && `${inferred} inferred to confirm`].filter(Boolean).join(", ");
        attention.push({ kind: "review", label: "Review", reason: `${parts}.`, cta: "Continue review", href: links.review(h.id), rank: 3 });
      }
      if (gaps || openGaps) {
        const n = gaps || openGaps;
        attention.push({ kind: "gaps", label: "Gap questions", reason: `${plural(n, "question")} nobody has answered yet${gaps ? " (required to publish)" : ""}.`, cta: "Open gaps", href: links.gaps(h.id), rank: 4 });
      }
      if (r?.canPublish && h.viewerIsCreator) {
        attention.push({ kind: "publish", label: "Ready", reason: "Every point is decided. Publish when you're ready.", cta: "Publish", href: links.review(h.id), rank: 3 });
      }
    }
  } else if (stage === "published") {
    status = side === "receiving" ? "Waiting for your acknowledgement" : "Published · waiting for the incoming person";
    cta = side === "receiving" ? "Read and acknowledge" : "Open";
    href = links.published(h.id);
    if (side === "receiving") {
      attention.push({ kind: "acknowledge", label: "Acknowledge", reason: "Read the handover and confirm you've received it.", cta, href, rank: 5 });
      health = "attention";
    }
  } else {
    status = "Acknowledged";
    href = links.published(h.id);
    cta = side === "receiving" ? "Read again" : "Open";
  }

  attention.sort((a, b) => a.rank - b.rank);
  if (attention.length && health === "ok") health = "attention";
  return { id: h.id, title: h.title, team: h.teamName, role: h.viewerRole, isCreator: h.viewerIsCreator, side, stage, status, health, progress, progressLabel, people, attention, cta, href, updatedAt: h.updatedAt };
}

/* ── Filtering ─────────────────────────────────────────────────────────────── */

export type StatusFilter = "all" | "attention" | Stage;
export const STATUS_FILTERS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs you" },
  { id: "draft", label: "Drafts" },
  { id: "processing", label: "Processing" },
  { id: "review", label: "In review" },
  { id: "published", label: "Published" },
  { id: "acknowledged", label: "Acknowledged" },
];

export type SideFilter = "all" | Side;

export function matchesStatus(row: DashboardRow, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "attention") return row.attention.length > 0;
  return row.stage === f;
}

export function matchesQuery(row: DashboardRow, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return true;
  const hay = [row.title, row.team, row.status, roleLabel(row.role), ...row.people.map((p) => p.name)].join(" ").toLocaleLowerCase();
  return needle.split(/\s+/).every((w) => hay.includes(w));
}

export function filterRows(rows: readonly DashboardRow[], opts: { status: StatusFilter; side: SideFilter; query: string }): DashboardRow[] {
  return rows.filter((r) => matchesStatus(r, opts.status) && (opts.side === "all" || r.side === opts.side) && matchesQuery(r, opts.query));
}

export function countByStatus(rows: readonly DashboardRow[]): Record<StatusFilter, number> {
  const out = Object.fromEntries(STATUS_FILTERS.map((f) => [f.id, 0])) as Record<StatusFilter, number>;
  for (const r of rows) for (const f of STATUS_FILTERS) if (matchesStatus(r, f.id)) out[f.id] += 1;
  return out;
}

/** Ordering: most urgent attention first, then most recently updated. */
export function sortRows(rows: readonly DashboardRow[]): DashboardRow[] {
  const urgency = (r: DashboardRow) => (r.attention.length ? r.attention[0].rank : 99);
  return [...rows].sort((a, b) => urgency(a) - urgency(b) || (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** The attention queue: every item across handovers, most urgent first, each tagged with its handover. */
export function attentionQueue(rows: readonly DashboardRow[]): (AttentionItem & { handoverId: string; title: string; team: string })[] {
  return rows
    .flatMap((r) => r.attention.map((a) => ({ ...a, handoverId: r.id, title: r.title, team: r.team })))
    .sort((a, b) => a.rank - b.rank);
}

/** Where to resume: the most recently updated handover the viewer is actively working on. */
export function resumeTarget(rows: readonly DashboardRow[]): DashboardRow | null {
  const active = rows.filter((r) => r.side === "preparing" && (r.stage === "draft" || r.stage === "review") && r.cta !== "Open");
  return [...active].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
}

/* ── Activity ──────────────────────────────────────────────────────────────── */

export interface ActivityItem {
  id: string;
  at: string;
  text: string;
  handover: string;
  href: string;
  tone: "neutral" | "good" | "bad";
}

/** Recent activity derived from data the queries already return (runs, gap answers, state, updates). */
export function deriveActivity(inputs: readonly HandoverInput[], rows: readonly DashboardRow[], limit = 8): ActivityItem[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ActivityItem[] = [];
  for (const i of inputs) {
    const h = i.summary;
    const row = byId.get(h.id);
    if (!row) continue;
    const run = i.processing?.run;
    if (run?.finishedAt) {
      const failed = run.status === "failed" || run.status === "cancelled";
      out.push({ id: `${h.id}-run`, at: run.finishedAt, text: failed ? "Processing stopped with an error" : "Processing finished", handover: h.title, href: row.href, tone: failed ? "bad" : "good" });
    }
    for (const g of i.gaps ?? []) {
      for (const a of g.answers) {
        if (a.privacyHeld) continue;
        out.push({ id: `${h.id}-${a.id}`, at: a.createdAt, text: `${a.answererLabel} answered a gap question`, handover: h.title, href: row.href, tone: "neutral" });
      }
    }
    const verb: Record<Stage, string> = {
      draft: "Draft saved",
      processing: "Processing started",
      review: "Review updated",
      published: "Published",
      acknowledged: "Acknowledged by the incoming person",
    };
    out.push({ id: `${h.id}-state`, at: h.updatedAt, text: verb[row.stage], handover: h.title, href: row.href, tone: row.stage === "published" || row.stage === "acknowledged" ? "good" : "neutral" });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

/** "3 min ago", "yesterday", "12 Oct". Deterministic given `now` (render on the client only). */
export function relativeTime(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Activity grouped for a timeline: "Today", "Yesterday", "Earlier this week", "Earlier" (by local calendar day). */
export function groupActivityByDay(items: readonly ActivityItem[], now: Date): { label: string; items: ActivityItem[] }[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const DAY = 86_400_000;
  const order = ["Today", "Yesterday", "Earlier this week", "Earlier"] as const;
  const buckets = new Map<string, ActivityItem[]>();
  for (const it of items) {
    const t = Date.parse(it.at);
    if (Number.isNaN(t)) continue;
    const d = startOfDay(new Date(t));
    const label = d >= today ? order[0] : d >= today - DAY ? order[1] : d >= today - 6 * DAY ? order[2] : order[3];
    buckets.set(label, [...(buckets.get(label) ?? []), it]);
  }
  return order.filter((l) => buckets.has(l)).map((label) => ({ label, items: buckets.get(label)! }));
}
