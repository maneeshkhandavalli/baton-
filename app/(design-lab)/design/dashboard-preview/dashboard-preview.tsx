"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  FileClock,
  FilePen,
  Inbox,
  LayoutGrid,
  Loader2,
  Menu,
  MessageCircleQuestion,
  Plus,
  Scale,
  Search,
  ShieldAlert,
  Stamp,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  attentionQueue,
  countByStatus,
  filterRows,
  relativeTime,
  resumeTarget,
  roleLabel,
  STAGES,
  STATUS_FILTERS,
  type ActivityItem,
  type AttentionKind,
  type DashboardRow,
  type SideFilter,
  type Stage,
  type StatusFilter,
} from "@/components/dashboard/model";
import { formatDate } from "@/components/handover/format";
import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn } from "@/lib/utils";

interface Props {
  rows: DashboardRow[];
  activity: ActivityItem[];
  viewer: { name: string; email: string };
  newHref: string;
}

const SIDE_FILTERS: { id: SideFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "preparing", label: "I'm handing over" },
  { id: "receiving", label: "Handed to me" },
];

const KIND_ICON: Record<AttentionKind, typeof Scale> = {
  offer: Stamp,
  failed: AlertOctagon,
  conflicts: Scale,
  review: FilePen,
  gaps: MessageCircleQuestion,
  publish: CheckCircle2,
  acknowledge: Inbox,
  privacy: ShieldAlert,
};

const KIND_TONE: Record<AttentionKind, string> = {
  offer: "text-(--dp-primary-fg) bg-(--dp-primary-soft)",
  failed: "text-(--dp-danger-fg) bg-(--dp-danger-soft)",
  conflicts: "text-(--dp-conflict-fg) bg-(--dp-conflict-soft)",
  privacy: "text-(--dp-warning-fg) bg-(--dp-warning-soft)",
  review: "text-(--dp-warning-fg) bg-(--dp-warning-soft)",
  gaps: "text-(--dp-fg) bg-(--dp-muted)",
  publish: "text-(--dp-success-fg) bg-(--dp-success-soft)",
  acknowledge: "text-(--dp-primary-fg) bg-(--dp-primary-soft)",
};

/** Relative time after hydration only (server and first client render show the same absolute date). */
let minuteCache = 0;
const subscribeMinute = (cb: () => void) => {
  const t = window.setInterval(cb, 30_000);
  return () => window.clearInterval(t);
};
const getMinute = () => {
  const m = Math.floor(Date.now() / 60_000);
  if (m !== minuteCache) minuteCache = m;
  return minuteCache;
};
const getServerMinute = () => 0;
function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribeMinute, getMinute, getServerMinute);
  return minute ? new Date(minute * 60_000) : null;
}

function When({ iso, now }: { iso: string; now: Date | null }) {
  return (
    <time dateTime={iso} title={formatDate(iso)} suppressHydrationWarning>
      {now ? relativeTime(iso, now) : formatDate(iso)}
    </time>
  );
}

export function DashboardPreview({ rows, activity, viewer, newHref }: Props) {
  const params = useSearchParams();
  const initialStatus = (STATUS_FILTERS.find((f) => f.id === params.get("status"))?.id ?? "all") as StatusFilter;
  const initialSide = (SIDE_FILTERS.find((f) => f.id === params.get("side"))?.id ?? "all") as SideFilter;
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [side, setSide] = useState<SideFilter>(initialSide);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [drawer, setDrawer] = useState(false);
  const now = useNow();
  const registerRef = useRef<HTMLElement>(null);

  // Keep the filters in the URL (refresh/back keep them) without a navigation.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string, def: string) => (v && v !== def ? sp.set(k, v) : sp.delete(k));
    set("status", status, "all");
    set("side", side, "all");
    set("q", query.trim(), "");
    const qs = sp.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [status, side, query]);

  const scoped = useMemo(() => filterRows(rows, { status: "all", side, query: "" }), [rows, side]);
  const counts = useMemo(() => countByStatus(scoped), [scoped]);
  const visible = useMemo(() => filterRows(rows, { status, side, query }), [rows, status, side, query]);
  const queue = useMemo(() => attentionQueue(rows), [rows]);
  const resume = useMemo(() => resumeTarget(rows), [rows]);
  const allCounts = useMemo(() => countByStatus(rows), [rows]);
  const openHandovers = useMemo(() => rows.filter((r) => r.stage !== "acknowledged").slice(0, 5), [rows]);

  const showStatus = useCallback((f: StatusFilter) => {
    setStatus(f);
    setDrawer(false);
    window.requestAnimationFrame(() => registerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const clearFilters = () => {
    setStatus("all");
    setSide("all");
    setQuery("");
  };

  const drafts = allCounts.draft;
  const inReview = allCounts.review;
  const toAck = rows.filter((r) => r.attention.some((a) => a.kind === "acknowledge")).length;

  const sidebar = (
    <Sidebar
      rows={openHandovers}
      counts={allCounts}
      status={status}
      onStatus={showStatus}
      viewer={viewer}
      newHref={newHref}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a href="#dp-main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-(--dp-card) focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-(--dp-border) bg-(--dp-bg) lg:block">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-(--dp-border) bg-(--dp-bg) px-4 lg:hidden">
        <BatonLogo size="sm" />
        <div className="flex items-center gap-1">
          <ThemeToggle size="icon-lg" />
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            aria-expanded={drawer}
            className="inline-flex size-10 items-center justify-center rounded-md hover:bg-(--dp-muted)"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {drawer && <Drawer onClose={() => setDrawer(false)}>{sidebar}</Drawer>}

      <main id="dp-main" tabIndex={-1} className="min-w-0 outline-none">
        <div className="mx-auto w-full max-w-[1240px] px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-(--dp-border) bg-(--dp-card) px-3 py-1 text-[12px] text-(--dp-muted-fg)">
            <CircleDot className="size-3.5 text-(--dp-primary)" aria-hidden="true" />
            Preview with fixture data. Links open the dev preview pages.
          </p>

          {/* Page header: title, one-sentence state of the workspace, the one primary action */}
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-(--dp-muted-fg)">Workspace</p>
              <h1 className="dp-title mt-1 text-[28px] leading-tight font-bold sm:text-[32px]">Handovers</h1>
              <p className="mt-2 max-w-2xl text-[15px] text-(--dp-muted-fg)">
                <strong className="font-semibold text-(--dp-fg)">{queue.length === 0 ? "Nothing needs you." : `${queue.length} ${queue.length === 1 ? "thing needs" : "things need"} you.`}</strong>{" "}
                {drafts} {drafts === 1 ? "draft" : "drafts"} in progress, {inReview} in review
                {toAck > 0 ? `, ${toAck} waiting for your acknowledgement` : ""}.
              </p>
            </div>
            <Link
              href={newHref}
              className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-md bg-(--dp-primary) px-4 text-sm font-semibold text-(--dp-on-primary) transition-colors hover:bg-(--dp-primary-hover) sm:self-auto"
            >
              <Plus className="size-4" aria-hidden="true" />
              New handover
            </Link>
          </header>

          {/* Row 1: the attention queue (what needs me) beside resume + pipeline (where things are) */}
          <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <AttentionQueue items={queue} onSeeAll={() => showStatus("attention")} />
            <div className="grid content-start gap-5">
              {resume && <ResumeCard row={resume} now={now} />}
              <Pipeline counts={allCounts} active={status} onPick={showStatus} />
            </div>
          </div>

          {/* Row 2: the register (all handovers, filter + search), full width so titles and blockers read */}
          <div className="mt-10">
            <section ref={registerRef} aria-labelledby="dp-register" className="min-w-0 scroll-mt-20">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="dp-register" className="dp-title text-[18px] font-bold">
                  All handovers
                </h2>
                <p className="text-[13px] text-(--dp-muted-fg)" aria-live="polite">
                  Showing <span className="dp-mono">{visible.length}</span> of <span className="dp-mono">{rows.length}</span>
                </p>
              </div>

              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative flex-1">
                    <span className="sr-only">Search handovers</span>
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--dp-muted-fg)" aria-hidden="true" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by title, team or person"
                      className="h-10 w-full rounded-md border border-(--dp-input) bg-(--dp-card) pr-9 pl-9 text-[16px] placeholder:text-(--dp-muted-fg) sm:text-sm"
                    />
                    {query && (
                      <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded hover:bg-(--dp-muted)">
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </label>
                  <div role="radiogroup" aria-label="Whose handovers" className="inline-flex h-10 shrink-0 rounded-md border border-(--dp-border) bg-(--dp-sunken) p-0.5">
                    {SIDE_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="radio"
                        aria-checked={side === f.id}
                        onClick={() => setSide(f.id)}
                        className={cn(
                          "rounded px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                          side === f.id ? "bg-(--dp-card) text-(--dp-fg) shadow-(--dp-shadow)" : "text-(--dp-muted-fg) hover:text-(--dp-fg)",
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div role="group" aria-label="Filter by status" className="dp-scroll-x -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={status === f.id}
                      onClick={() => setStatus(f.id)}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                        status === f.id
                          ? "border-(--dp-primary) bg-(--dp-primary-soft) text-(--dp-primary-fg)"
                          : "border-(--dp-border) bg-(--dp-card) text-(--dp-muted-fg) hover:border-(--dp-border-strong) hover:text-(--dp-fg)",
                      )}
                    >
                      {f.label}
                      <span className="dp-mono text-[12px] opacity-80">{counts[f.id]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="dp-card mt-3 overflow-hidden">
                <div className="hidden grid-cols-[minmax(0,1.6fr)_140px_minmax(0,1.4fr)_84px_84px_16px] gap-4 border-b border-(--dp-border) bg-(--dp-sunken) px-4 py-2 text-[12px] font-semibold text-(--dp-muted-fg) md:grid">
                  <span>Handover</span>
                  <span>Stage</span>
                  <span>Where it is</span>
                  <span>People</span>
                  <span>Updated</span>
                  <span />
                </div>
                {visible.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                    <Search className="size-5 text-(--dp-muted-fg)" aria-hidden="true" />
                    <p className="font-semibold">No handovers match these filters</p>
                    <p className="text-[13px] text-(--dp-muted-fg)">Try another word, or show everything again.</p>
                    <button type="button" onClick={clearFilters} className="mt-2 h-9 rounded-md border border-(--dp-border-strong) bg-(--dp-card) px-3 text-sm font-medium hover:bg-(--dp-muted)">
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <ul className="divide-y divide-(--dp-border)">
                    {visible.map((r) => (
                      <RegisterRow key={r.id} row={r} now={now} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* Row 3: recent activity */}
          <div className="mt-10">
            <ActivityFeed items={activity} now={now} />
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

function Sidebar({
  rows,
  counts,
  status,
  onStatus,
  viewer,
  newHref,
  onNavigate,
}: {
  rows: DashboardRow[];
  counts: Record<StatusFilter, number>;
  status: StatusFilter;
  onStatus: (f: StatusFilter) => void;
  viewer: { name: string; email: string };
  newHref: string;
  onNavigate: () => void;
}) {
  const views: { id: StatusFilter; label: string; icon: typeof LayoutGrid }[] = [
    { id: "attention", label: "Needs you", icon: Inbox },
    { id: "draft", label: "Drafts", icon: FilePen },
    { id: "review", label: "In review", icon: Scale },
    { id: "published", label: "Published", icon: Stamp },
  ];
  const item = "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[14px] font-medium transition-colors";
  return (
    <nav aria-label="Workspace" className="flex h-full flex-col gap-6 px-3 pt-4 pb-20">
      <div className="flex items-center justify-between pl-2">
        <BatonLogo />
        <span className="hidden lg:block">
          <ThemeToggle size="icon-sm" />
        </span>
      </div>
      <Link href={newHref} onClick={onNavigate} className={cn(item, "border border-(--dp-border) bg-(--dp-card) text-(--dp-fg) shadow-(--dp-shadow) hover:border-(--dp-border-strong)")}>
        <Plus className="size-4 text-(--dp-primary)" aria-hidden="true" />
        New handover
      </Link>
      <div className="space-y-0.5">
        <a href="#dp-main" onClick={onNavigate} aria-current="page" className={cn(item, "relative bg-(--dp-primary-soft) text-(--dp-primary-fg) before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded before:bg-(--dp-primary)")}>
          <LayoutGrid className="size-4" aria-hidden="true" />
          Overview
        </a>
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onStatus(v.id)}
            aria-pressed={status === v.id}
            className={cn(item, "text-(--dp-muted-fg) hover:bg-(--dp-muted) hover:text-(--dp-fg)", status === v.id && "text-(--dp-fg)")}
          >
            <v.icon className="size-4" aria-hidden="true" />
            <span className="flex-1 text-left">{v.label}</span>
            <span className={cn("dp-mono rounded px-1.5 text-[12px]", v.id === "attention" && counts.attention > 0 ? "bg-(--dp-warning-soft) text-(--dp-warning-fg)" : "text-(--dp-muted-fg)")}>{counts[v.id]}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-2.5 text-[12px] font-semibold text-(--dp-muted-fg)">Open handovers</p>
        <ul className="mt-1.5 space-y-0.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} onClick={onNavigate} className="group flex items-start gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-(--dp-muted)">
                <StageDot stage={r.stage} health={r.health} className="mt-1.5" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium group-hover:underline">{r.title}</span>
                  <span className="block truncate text-[12px] text-(--dp-muted-fg)">{r.team}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-(--dp-border) pt-3">
        <Link href="/account" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-(--dp-muted)">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--dp-primary-soft) text-[13px] font-semibold text-(--dp-primary-fg)">
            {viewer.name[0]}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">{viewer.name}</span>
            <span className="block truncate text-[12px] text-(--dp-muted-fg)">{viewer.email}</span>
          </span>
          <UserRound className="ml-auto size-4 shrink-0 text-(--dp-muted-fg)" aria-hidden="true" />
          <span className="sr-only">Account settings</span>
        </Link>
      </div>
    </nav>
  );
}

function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button type="button" aria-label="Close navigation" onClick={onClose} className="absolute inset-0 bg-black/40" tabIndex={-1} />
      <div ref={panel} className="relative h-full w-[86%] max-w-[320px] border-r border-(--dp-border) bg-(--dp-bg)">
        <button type="button" onClick={onClose} aria-label="Close navigation" className="absolute top-3 right-3 z-10 inline-flex size-9 items-center justify-center rounded-md hover:bg-(--dp-muted)">
          <X className="size-5" aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ── Attention queue ─────────────────────────────────────────────────────── */

function AttentionQueue({ items, onSeeAll }: { items: ReturnType<typeof attentionQueue>; onSeeAll: () => void }) {
  const shown = items.slice(0, 6);
  return (
    <section aria-labelledby="dp-attention" className="dp-card min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-(--dp-border) px-4 py-3">
        <h2 id="dp-attention" className="dp-title flex items-center gap-2 text-[18px] font-bold">
          Needs your attention
          <span className="dp-mono rounded bg-(--dp-warning-soft) px-1.5 text-[13px] font-medium text-(--dp-warning-fg)">{items.length}</span>
        </h2>
        {items.length > 0 && (
          <button type="button" onClick={onSeeAll} className="text-[13px] font-medium text-(--dp-primary-fg) hover:underline">
            Show in list
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-8">
          <CheckCircle2 className="size-5 text-(--dp-success)" aria-hidden="true" />
          <p>You&rsquo;re all caught up. Nothing is waiting on you.</p>
        </div>
      ) : (
        <ol className="divide-y divide-(--dp-border)">
          {shown.map((a, i) => {
            const Icon = KIND_ICON[a.kind];
            return (
              <li key={`${a.handoverId}-${a.kind}-${i}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:gap-x-4">
                <span className={cn("inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold", KIND_TONE[a.kind])}>
                  <Icon className="size-3.5" aria-hidden="true" />
                  {a.label}
                </span>
                <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <p className="truncate font-semibold">
                    {a.title}
                    <span className="font-normal text-(--dp-muted-fg)"> · {a.team}</span>
                  </p>
                  <p className="text-[13px] text-(--dp-muted-fg)">{a.reason}</p>
                </div>
                <Link
                  href={a.href}
                  aria-label={`${a.cta}: ${a.title}`}
                  className="col-start-2 row-start-1 inline-flex h-8 shrink-0 items-center gap-1 justify-self-end rounded-md border border-(--dp-border-strong) px-3 text-[13px] font-semibold hover:border-(--dp-primary) hover:text-(--dp-primary-fg) sm:col-start-3"
                >
                  {a.cta}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > shown.length && (
        <button type="button" onClick={onSeeAll} className="w-full border-t border-(--dp-border) px-4 py-2.5 text-left text-[13px] font-medium text-(--dp-primary-fg) hover:bg-(--dp-muted)">
          {items.length - shown.length} more in the list
        </button>
      )}
    </section>
  );
}

/* ── Resume + pipeline ───────────────────────────────────────────────────── */

function ResumeCard({ row, now }: { row: DashboardRow; now: Date | null }) {
  return (
    <section aria-labelledby="dp-resume" className="dp-card p-4">
      <h2 id="dp-resume" className="text-[12px] font-semibold text-(--dp-muted-fg)">
        Pick up where you left off
      </h2>
      <p className="dp-title mt-2 text-[17px] leading-snug font-bold">{row.title}</p>
      <p className="text-[13px] text-(--dp-muted-fg)">
        {row.team} · edited <When iso={row.updatedAt} now={now} />
      </p>
      <p className="mt-3 text-[13px]">{row.status}</p>
      {row.progress !== null && <Meter value={row.progress} label={row.progressLabel ?? ""} className="mt-2" />}
      <Link href={row.href} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-(--dp-primary) text-sm font-semibold text-(--dp-primary-fg) hover:bg-(--dp-primary-soft)">
        {row.cta}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

function Pipeline({ counts, active, onPick }: { counts: Record<StatusFilter, number>; active: StatusFilter; onPick: (f: StatusFilter) => void }) {
  const total = STAGES.reduce((n, s) => n + counts[s.id], 0) || 1;
  return (
    <section aria-labelledby="dp-pipeline" className="dp-card p-4">
      <h2 id="dp-pipeline" className="text-[12px] font-semibold text-(--dp-muted-fg)">
        Where your handovers are
      </h2>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-(--dp-track)" aria-hidden="true">
        {STAGES.map((s) => (counts[s.id] ? <span key={s.id} className={cn("h-full", STAGE_FILL[s.id])} style={{ width: `${(counts[s.id] / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-3 space-y-0.5">
        {STAGES.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s.id)}
              aria-pressed={active === s.id}
              className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-(--dp-muted)", active === s.id && "bg-(--dp-muted) font-semibold")}
            >
              <span className={cn("size-2.5 rounded-sm", STAGE_FILL[s.id])} aria-hidden="true" />
              <span className="flex-1 text-left">{s.label}</span>
              <span className="dp-mono text-(--dp-muted-fg)">{counts[s.id]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Register row ────────────────────────────────────────────────────────── */

const STAGE_FILL: Record<Stage, string> = {
  draft: "bg-(--dp-border-strong)",
  processing: "bg-(--dp-warning)",
  review: "bg-(--dp-primary)",
  published: "bg-(--dp-success)",
  acknowledged: "bg-(--dp-success-fg)",
};

function StageDot({ stage, health, className }: { stage: Stage; health: DashboardRow["health"]; className?: string }) {
  if (health === "failed") return <AlertOctagon className={cn("size-3 shrink-0 text-(--dp-danger)", className)} aria-hidden="true" />;
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", STAGE_FILL[stage], className)} />;
}

function StageTrack({ stage, health }: { stage: Stage; health: DashboardRow["health"] }) {
  const idx = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="min-w-0">
      <div className="flex gap-0.5" aria-hidden="true">
        {STAGES.map((s, i) => (
          <span
            key={s.id}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < idx ? "bg-(--dp-primary) opacity-45" : i === idx ? (health === "failed" ? "bg-(--dp-danger)" : STAGE_FILL[s.id]) : "bg-(--dp-track)",
            )}
          />
        ))}
      </div>
      <p className={cn("mt-1 flex items-center gap-1 text-[12px] font-semibold", health === "failed" ? "text-(--dp-danger-fg)" : "text-(--dp-fg)")}>
        {health === "running" && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
        {health === "failed" ? "Processing failed" : STAGES[idx].label}
      </p>
    </div>
  );
}

function Meter({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className={className}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className="h-1.5 overflow-hidden rounded-full bg-(--dp-track)">
        <div className="h-full rounded-full bg-(--dp-primary)" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <p className="mt-1 text-[12px] text-(--dp-muted-fg)">{label}</p>
    </div>
  );
}

function People({ people }: { people: DashboardRow["people"] }) {
  if (!people.length) return <span className="text-[12px] text-(--dp-muted-fg)">Only you</span>;
  const shown = people.slice(0, 3);
  return (
    <span className="flex items-center" title={people.map((p) => `${p.name} (${roleLabel(p.role)})`).join(", ")}>
      <span className="sr-only">{people.map((p) => `${p.name}, ${roleLabel(p.role)}`).join("; ")}</span>
      {shown.map((p, i) => (
        <span
          key={`${p.name}-${i}`}
          aria-hidden="true"
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2 border-(--dp-card) text-[11px] font-semibold",
            p.role === "incoming" ? "bg-(--dp-primary-soft) text-(--dp-primary-fg)" : "bg-(--dp-muted) text-(--dp-fg)",
            i > 0 && "-ml-1.5",
          )}
        >
          {p.name[0]}
        </span>
      ))}
      {people.length > 3 && <span aria-hidden="true" className="ml-1 text-[12px] text-(--dp-muted-fg)">+{people.length - 3}</span>}
    </span>
  );
}

function RegisterRow({ row, now }: { row: DashboardRow; now: Date | null }) {
  return (
    <li className="group relative grid gap-x-4 gap-y-2 px-4 py-3 hover:bg-(--dp-sunken) md:grid-cols-[minmax(0,1.6fr)_140px_minmax(0,1.4fr)_84px_84px_16px] md:items-center">
      <div className="min-w-0">
        <p className="truncate font-semibold">
          <Link href={row.href} className="after:absolute after:inset-0 group-hover:underline" aria-label={`${row.title}, ${row.team}. ${row.cta}`}>
            {row.title}
          </Link>
        </p>
        <p className="truncate text-[13px] text-(--dp-muted-fg)">
          {row.team} · {roleLabel(row.role)}
          {row.isCreator ? " · creator" : ""}
        </p>
      </div>
      <StageTrack stage={row.stage} health={row.health} />
      <div className="min-w-0">
        <p className={cn("text-[13px]", row.attention.length ? "font-medium text-(--dp-fg)" : "text-(--dp-muted-fg)")}>
          {row.attention.length > 0 && <span className="mr-1.5 inline-block size-1.5 -translate-y-0.5 rounded-full bg-(--dp-warning)" aria-hidden="true" />}
          {row.status}
        </p>
        {row.progress !== null && (
          <div className="mt-1.5 h-1 max-w-48 overflow-hidden rounded-full bg-(--dp-track)" aria-hidden="true">
            <div className="h-full rounded-full bg-(--dp-primary)" style={{ width: `${Math.round(row.progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 md:contents">
        <People people={row.people} />
        <span className="text-[12px] text-(--dp-muted-fg)">
          <When iso={row.updatedAt} now={now} />
        </span>
        <ChevronRight className="hidden size-4 text-(--dp-muted-fg) md:block" aria-hidden="true" />
      </div>
    </li>
  );
}

/* ── Activity ────────────────────────────────────────────────────────────── */

function ActivityFeed({ items, now }: { items: ActivityItem[]; now: Date | null }) {
  return (
    <section aria-labelledby="dp-activity" className="min-w-0">
      <h2 id="dp-activity" className="dp-title text-[18px] font-bold">
        Recent activity
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-[13px] text-(--dp-muted-fg)">Nothing has happened yet. Activity appears here as handovers move.</p>
      ) : (
        <ol className="mt-3 grid gap-x-10 lg:grid-cols-2">
          {items.map((a) => (
            <li key={a.id} className="relative border-l border-(--dp-border) py-2 pl-5">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-3.5 -left-[5px] size-2.5 rounded-full border-2 border-(--dp-bg)",
                  a.tone === "good" ? "bg-(--dp-success)" : a.tone === "bad" ? "bg-(--dp-danger)" : "bg-(--dp-border-strong)",
                )}
              />
              <p className="text-[13px]">
                {a.text}{" "}
                <Link href={a.href} className="font-semibold hover:underline">
                  {a.handover}
                </Link>
              </p>
              <p className="dp-mono text-[12px] text-(--dp-muted-fg)">
                <When iso={a.at} now={now} />
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 flex max-w-xl items-start gap-2 rounded-md border border-dashed border-(--dp-border-strong) p-3 text-[12px] text-(--dp-muted-fg)">
        <FileClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Built from processing runs, gap answers and handover updates already in Baton. Nothing extra is tracked.
      </p>
    </section>
  );
}
