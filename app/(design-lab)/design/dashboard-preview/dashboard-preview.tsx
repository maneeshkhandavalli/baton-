"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertOctagon,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FilePen,
  Inbox,
  LayoutGrid,
  Menu,
  MessageCircleQuestion,
  Plus,
  Scale,
  Search,
  ShieldAlert,
  Stamp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import {
  attentionQueue,
  countByStatus,
  filterRows,
  groupActivityByDay,
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

type QueueItem = ReturnType<typeof attentionQueue>[number];

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

/** Kind colour = system tone only (status), never an evidence colour. Text label always present. */
const KIND_TONE: Record<AttentionKind, string> = {
  offer: "text-(--dp-primary-fg)",
  failed: "text-(--dp-danger-fg)",
  conflicts: "text-(--dp-warning-fg)",
  privacy: "text-(--dp-warning-fg)",
  review: "text-(--dp-warning-fg)",
  gaps: "text-(--dp-muted-fg)",
  publish: "text-(--dp-success-fg)",
  acknowledge: "text-(--dp-primary-fg)",
};

const STAGE_COLOR: Record<Stage, string> = {
  draft: "text-(--dp-stage-draft)",
  processing: "text-(--dp-stage-processing)",
  review: "text-(--dp-stage-review)",
  published: "text-(--dp-stage-published)",
  acknowledged: "text-(--dp-stage-acknowledged)",
};

/* ── Time (relative after hydration only) ────────────────────────────────── */

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

/* ── Stage glyph: shape AND tide colour encode the stage ─────────────────── */

function StageGlyph({ stage, failed = false, className }: { stage: Stage; failed?: boolean; className?: string }) {
  if (failed) return <AlertOctagon aria-hidden="true" className={cn("size-3.5 shrink-0 text-(--dp-danger)", className)} />;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-3.5 shrink-0", STAGE_COLOR[stage], stage === "processing" && "dp-processing-pulse", className)}>
      {stage === "draft" && <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2" />}
      {stage === "processing" && (
        <>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 2.5 A5.5 5.5 0 0 1 13.5 8 L8 8 Z" fill="currentColor" />
        </>
      )}
      {stage === "review" && (
        <>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 Z" fill="currentColor" />
        </>
      )}
      {stage === "published" && <circle cx="8" cy="8" r="6.25" fill="currentColor" />}
      {stage === "acknowledged" && (
        <>
          <circle cx="8" cy="8" r="6.25" fill="currentColor" />
          <path d="M5.2 8.2 7.2 10.1 10.9 6.1" fill="none" stroke="var(--dp-bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export function DashboardPreview({ rows, activity, viewer, newHref }: Props) {
  const params = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() => (STATUS_FILTERS.find((f) => f.id === params.get("status"))?.id ?? "all") as StatusFilter);
  const [side, setSide] = useState<SideFilter>(() => (SIDE_FILTERS.find((f) => f.id === params.get("side"))?.id ?? "all") as SideFilter);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [drawer, setDrawer] = useState(false);
  const now = useNow();
  const libraryRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Filters live in the URL (refresh and Back keep them) without a navigation.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string, def: string) => (v && v !== def ? sp.set(k, v) : sp.delete(k));
    set("status", status, "all");
    set("side", side, "all");
    set("q", query.trim(), "");
    const qs = sp.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [status, side, query]);

  // "/" focuses search (unless typing somewhere already).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const scoped = useMemo(() => filterRows(rows, { status: "all", side, query: "" }), [rows, side]);
  const counts = useMemo(() => countByStatus(scoped), [scoped]);
  const allCounts = useMemo(() => countByStatus(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, { status, side, query }), [rows, status, side, query]);
  const queue = useMemo(() => attentionQueue(rows), [rows]);
  const resume = useMemo(() => resumeTarget(rows), [rows]);
  const openHandovers = useMemo(() => rows.filter((r) => r.stage !== "acknowledged").slice(0, 4), [rows]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const showStatus = useCallback((f: StatusFilter) => {
    setStatus(f);
    setDrawer(false);
    window.requestAnimationFrame(() => libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const clearFilters = () => {
    setStatus("all");
    setSide("all");
    setQuery("");
  };

  const handoversNeeding = new Set(queue.map((q) => q.handoverId)).size;
  const toAck = queue.filter((q) => q.kind === "acknowledge").length;

  const sidebar = (
    <Sidebar
      open={openHandovers}
      counts={allCounts}
      status={status}
      onStatus={showStatus}
      viewer={viewer}
      newHref={newHref}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <a href="#dp-main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-(--dp-card) focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-(--dp-border) lg:block">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-(--dp-border) bg-(--dp-bg) px-4 lg:hidden">
        <BatonLogo size="sm" />
        <div className="flex items-center gap-1">
          <ThemeToggle size="icon-lg" />
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-expanded={drawer} className="inline-flex size-10 items-center justify-center rounded-md hover:bg-(--dp-muted)">
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <AnimatePresence>{drawer && <Drawer onClose={() => setDrawer(false)}>{sidebar}</Drawer>}</AnimatePresence>

      <main id="dp-main" tabIndex={-1} className="min-w-0 outline-none">
        {/* Header band: typographic summary + stage strip (landing grid, header only) */}
        <div className="relative border-b border-(--dp-border)">
          <div aria-hidden="true" className="dp-grid-band pointer-events-none absolute inset-0" />
          <div className="relative mx-auto w-full max-w-[1760px] px-4 pt-5 pb-6 sm:px-6 lg:px-8 lg:pt-7 2xl:px-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[13px] text-(--dp-muted-fg)">
                <span>Workspace</span>
                <span aria-hidden="true">/</span>
                <h1 className="dp-title text-[13px] font-semibold tracking-normal text-(--dp-fg)">Handovers</h1>
              </div>
              <p className="rounded-full border border-dashed border-(--dp-border-strong) px-2.5 py-0.5 text-[12px] text-(--dp-muted-fg)">Preview · fixture data · links open dev previews</p>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="min-w-0">
                <p className="dp-title text-[34px] leading-[1.05] font-bold sm:text-[44px] 2xl:text-[52px]">
                  {queue.length === 0 ? (
                    "You're all caught up."
                  ) : (
                    <>
                      <span className="text-(--dp-primary)">{queue.length}</span> {queue.length === 1 ? "thing needs" : "things need"} you
                    </>
                  )}
                </p>
                <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-(--dp-muted-fg)">
                  Across {handoversNeeding} of your {rows.length} handovers. {allCounts.draft} {allCounts.draft === 1 ? "draft is" : "drafts are"} being written, {allCounts.review} {allCounts.review === 1 ? "is" : "are"} in review
                  {toAck ? `, and ${toAck} ${toAck === 1 ? "waits" : "wait"} for your acknowledgement` : ""}.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 lg:hidden">
                  <Link href={newHref} className="inline-flex h-10 items-center gap-2 rounded-full bg-(--dp-primary) px-4 text-sm font-semibold text-(--dp-on-primary) hover:bg-(--dp-primary-hover)">
                    <Plus className="size-4" aria-hidden="true" />
                    New handover
                  </Link>
                </div>
              </div>
              <StageStrip rows={rows} counts={allCounts} active={status} onPick={showStatus} />
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1760px] px-4 pt-8 pb-28 sm:px-6 lg:px-8 2xl:px-12">
          <AttentionSplit items={queue} rowById={rowById} now={now} onSeeAll={() => showStatus("attention")} />

          <div className="mt-12 grid gap-10 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
            <Library
              ref={libraryRef}
              rows={rows}
              visible={visible}
              counts={counts}
              status={status}
              side={side}
              query={query}
              searchRef={searchRef}
              now={now}
              onStatus={setStatus}
              onSide={setSide}
              onQuery={setQuery}
              onClear={clearFilters}
            />
            <aside aria-label="Resume and activity" className="space-y-10 xl:sticky xl:top-6 xl:self-start">
              {resume && <Resume row={resume} now={now} />}
              <Timeline items={activity} now={now} />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

function Sidebar({
  open,
  counts,
  status,
  onStatus,
  viewer,
  newHref,
  onNavigate,
}: {
  open: DashboardRow[];
  counts: Record<StatusFilter, number>;
  status: StatusFilter;
  onStatus: (f: StatusFilter) => void;
  viewer: { name: string; email: string };
  newHref: string;
  onNavigate: () => void;
}) {
  const item = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors";
  const label = "px-2 pb-1 text-[12px] font-semibold text-(--dp-muted-fg)";
  return (
    <nav aria-label="Workspace" className="flex h-full flex-col px-3 pt-4 pb-20">
      <div className="flex h-9 items-center justify-between pl-2">
        <BatonLogo />
        <span className="hidden lg:block">
          <ThemeToggle size="icon-sm" />
        </span>
      </div>

      <Link href={newHref} onClick={onNavigate} className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-full bg-(--dp-primary) text-[13.5px] font-semibold text-(--dp-on-primary) transition-colors hover:bg-(--dp-primary-hover)">
        <Plus className="size-4" aria-hidden="true" />
        New handover
      </Link>

      <div className="mt-6 space-y-0.5">
        <a href="#dp-main" onClick={onNavigate} aria-current="page" className={cn(item, "relative font-semibold text-(--dp-fg) before:absolute before:inset-y-1.5 before:-left-3 before:w-0.5 before:rounded-r before:bg-(--dp-primary)")}>
          <LayoutGrid className="size-4 text-(--dp-primary)" aria-hidden="true" />
          Overview
        </a>
        <button type="button" onClick={() => onStatus("attention")} aria-pressed={status === "attention"} className={cn(item, "text-(--dp-muted-fg) hover:bg-(--dp-muted) hover:text-(--dp-fg)", status === "attention" && "bg-(--dp-muted) text-(--dp-fg)")}>
          <Inbox className="size-4" aria-hidden="true" />
          <span className="flex-1 text-left">Needs you</span>
          {counts.attention > 0 && <span className="dp-mono rounded-full bg-(--dp-primary) px-1.5 text-[11px] leading-[18px] text-(--dp-on-primary)">{counts.attention}</span>}
        </button>
      </div>

      <div className="mt-6">
        <p className={label}>Stages</p>
        <div className="space-y-0.5">
          {STAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStatus(s.id)}
              aria-pressed={status === s.id}
              className={cn(item, "text-(--dp-muted-fg) hover:bg-(--dp-muted) hover:text-(--dp-fg)", status === s.id && "bg-(--dp-muted) text-(--dp-fg)")}
            >
              <StageGlyph stage={s.id} />
              <span className="flex-1 text-left">{s.label}</span>
              <span className="dp-mono text-[12px]">{counts[s.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        <p className={label}>Open handovers</p>
        <ul className="space-y-0.5">
          {open.map((r) => (
            <li key={r.id}>
              <Link href={r.href} onClick={onNavigate} title={`${r.title} · ${r.team}`} className={cn(item, "text-(--dp-muted-fg) hover:bg-(--dp-muted) hover:text-(--dp-fg)")}>
                <StageGlyph stage={r.stage} failed={r.health === "failed"} />
                <span className="truncate">{r.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <Link href="/account" onClick={onNavigate} className="mt-3 flex items-center gap-2.5 rounded-md border-t border-(--dp-border) px-2 pt-3 pb-1 hover:text-(--dp-primary-fg)">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--dp-primary-soft) text-[12px] font-semibold text-(--dp-primary-fg)">
          {viewer.name[0]}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">{viewer.name}</span>
          <span className="block truncate text-[12px] text-(--dp-muted-fg)">Account settings</span>
        </span>
      </Link>
    </nav>
  );
}

function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
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
      <motion.button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 bg-black/40"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduce ? undefined : { opacity: 0 }}
      />
      <motion.div
        ref={panel}
        className="relative h-full w-[86%] max-w-[320px] border-r border-(--dp-border) bg-(--dp-bg)"
        initial={reduce ? false : { x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduce ? undefined : { x: -24, opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <button type="button" onClick={onClose} aria-label="Close navigation" className="absolute top-4 right-3 z-10 inline-flex size-9 items-center justify-center rounded-md hover:bg-(--dp-muted)">
          <X className="size-5" aria-hidden="true" />
        </button>
        {children}
      </motion.div>
    </div>
  );
}

/* ── Stage strip ─────────────────────────────────────────────────────────── */

function StageStrip({ rows, counts, active, onPick }: { rows: DashboardRow[]; counts: Record<StatusFilter, number>; active: StatusFilter; onPick: (f: StatusFilter) => void }) {
  return (
    <div role="group" aria-label="Handovers by stage" className="dp-scroll-x -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ol className="flex min-w-max divide-x divide-(--dp-border) rounded-xl border border-(--dp-border) bg-(--dp-card) shadow-(--dp-shadow)">
        {STAGES.map((s, i) => {
          const failed = s.id === "processing" && rows.some((r) => r.stage === "processing" && r.health === "failed");
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s.id)}
                aria-pressed={active === s.id}
                aria-label={`${s.label}: ${counts[s.id]}. Show in the list`}
                className={cn(
                  "group relative flex w-[112px] flex-col items-start gap-2 px-3.5 py-3 text-left transition-colors hover:bg-(--dp-sunken) 2xl:w-[128px]",
                  i === 0 && "rounded-l-xl",
                  i === STAGES.length - 1 && "rounded-r-xl",
                  active === s.id && "bg-(--dp-primary-soft)",
                )}
              >
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-(--dp-muted-fg)">
                  <StageGlyph stage={s.id} />
                  {s.label}
                </span>
                <span className="dp-mono text-[24px] leading-none font-medium">{counts[s.id]}</span>
                <span className="flex h-2.5 gap-[3px]" aria-hidden="true">
                  {rows
                    .filter((r) => r.stage === s.id)
                    .map((r) => (
                      <span key={r.id} className={cn("w-1 rounded-full", r.health === "failed" ? "bg-(--dp-danger)" : "bg-current", STAGE_COLOR[s.id])} />
                    ))}
                </span>
                {failed && <span className="absolute top-3 right-3 size-1.5 rounded-full bg-(--dp-danger)" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── Attention: split list + detail (the focal block) ────────────────────── */

function AttentionSplit({ items, rowById, now, onSeeAll }: { items: QueueItem[]; rowById: Map<string, DashboardRow>; now: Date | null; onSeeAll: () => void }) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const reduce = useReducedMotion();
  const index = Math.min(selected, Math.max(items.length - 1, 0));
  const current = items[index];
  const row = current ? rowById.get(current.handoverId) : undefined;

  const move = (to: number) => {
    const next = (to + items.length) % items.length;
    setSelected(next);
    listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-q]")[next]?.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!items.length) return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      move(index + 1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      move(index - 1);
    }
  };

  return (
    <section aria-labelledby="dp-attention" className="overflow-hidden rounded-2xl border border-(--dp-border) bg-(--dp-card) shadow-(--dp-shadow)">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--dp-border) px-5 py-3.5">
        <h2 id="dp-attention" className="dp-title flex items-center gap-2.5 text-[19px] font-bold">
          Needs your attention
          <span className="dp-mono rounded-full bg-(--dp-primary) px-2 text-[12px] leading-5 font-medium text-(--dp-on-primary)">{items.length}</span>
        </h2>
        <div className="flex items-center gap-4 text-[12px] text-(--dp-muted-fg)">
          <span className="hidden items-center gap-1.5 md:flex">
            <kbd className="dp-kbd">J</kbd>
            <kbd className="dp-kbd">K</kbd>
            to move
          </span>
          {items.length > 0 && (
            <button type="button" onClick={onSeeAll} className="font-medium text-(--dp-primary-fg) hover:underline">
              Show in the list
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-10">
          <CheckCircle2 className="size-5 text-(--dp-success)" aria-hidden="true" />
          <p>You&rsquo;re all caught up. Nothing is waiting on you.</p>
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_520px]">
          <ol ref={listRef} onKeyDown={onKeyDown} aria-label="Attention queue" className="divide-y divide-(--dp-border) lg:max-h-[460px] lg:overflow-y-auto">
            {items.map((a, i) => {
              const Icon = KIND_ICON[a.kind];
              const on = i === index;
              return (
                <li key={`${a.handoverId}-${a.kind}-${i}`}>
                  <button
                    type="button"
                    data-q
                    onClick={() => setSelected(i)}
                    aria-current={on ? "true" : undefined}
                    aria-controls="dp-attention-detail"
                    tabIndex={on ? 0 : -1}
                    className={cn(
                      "group relative grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-left transition-colors md:grid-cols-[8.5rem_minmax(0,1fr)_auto]",
                      on ? "bg-(--dp-primary-soft)" : "hover:bg-(--dp-sunken)",
                    )}
                  >
                    {on && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-(--dp-primary)" />}
                    <span className={cn("flex items-center gap-1.5 text-[12px] font-semibold", KIND_TONE[a.kind])}>
                      <Icon className="size-3.5" aria-hidden="true" />
                      {a.label}
                    </span>
                    <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1">
                      <span className="block truncate font-semibold">{a.title}</span>
                      <span className="block truncate text-[13px] text-(--dp-muted-fg)">{a.reason}</span>
                    </span>
                    <ArrowRight className={cn("col-start-2 row-start-1 size-4 justify-self-end text-(--dp-muted-fg) md:col-start-3", on ? "text-(--dp-primary)" : "dp-row-cue")} aria-hidden="true" />
                  </button>
                  {/* Below lg the detail opens inline under the selected item */}
                  {on && row && (
                    <div className="border-t border-(--dp-border) bg-(--dp-sunken) px-5 py-4 lg:hidden">
                      <DetailBody item={a} row={row} now={now} compact />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div id="dp-attention-detail" aria-live="polite" className="hidden border-l border-(--dp-border) bg-(--dp-sunken) lg:block">
            <AnimatePresence mode="wait" initial={false}>
              {current && row && (
                <motion.div
                  key={`${current.handoverId}-${current.kind}`}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="p-6"
                >
                  <DetailBody item={current} row={row} now={now} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </section>
  );
}

function DetailBody({ item, row, now, compact = false }: { item: QueueItem; row: DashboardRow; now: Date | null; compact?: boolean }) {
  const others = row.attention.filter((a) => a.kind !== item.kind);
  const stageIdx = STAGES.findIndex((s) => s.id === row.stage);
  return (
    <div>
      {!compact && (
        <>
          <p className="dp-mono text-[12px] text-(--dp-primary-fg)">
            ↳ {STAGES[stageIdx].label} · {row.team}
          </p>
          <h3 className="dp-title mt-1.5 text-[22px] leading-tight font-bold">{row.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed">{item.reason}</p>
        </>
      )}
      <div className={cn("flex flex-wrap gap-2", !compact && "mt-5")}>
        <Link href={item.href} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-(--dp-primary) px-4 text-[13.5px] font-semibold text-(--dp-on-primary) hover:bg-(--dp-primary-hover)">
          {item.cta}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {row.href !== item.href && (
          <Link href={row.href} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-(--dp-border-strong) px-4 text-[13.5px] font-medium hover:border-(--dp-primary) hover:text-(--dp-primary-fg)">
            Open handover
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Where this handover is: its own stage strip */}
      <ol aria-label={`Stage: ${STAGES[stageIdx].label}`} className="mt-6 grid grid-cols-5 gap-1">
        {STAGES.map((s, i) => (
          <li key={s.id} className="min-w-0">
            <span aria-hidden="true" className={cn("block h-1 rounded-full", i < stageIdx ? "bg-(--dp-stage-review)/60" : i === stageIdx ? (row.health === "failed" ? "bg-(--dp-danger)" : "bg-(--dp-primary)") : "bg-(--dp-track)")} />
            <span className={cn("mt-1.5 block truncate text-[11px]", i === stageIdx ? "font-semibold text-(--dp-fg)" : "text-(--dp-muted-fg)")}>{s.label}</span>
          </li>
        ))}
      </ol>

      <dl className="mt-5 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">
        <dt className="text-(--dp-muted-fg)">Where it is</dt>
        <dd>
          {row.status}
          {row.progress !== null && (
            <span className="mt-1.5 block">
              <span role="progressbar" aria-label={row.progressLabel ?? ""} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress * 100)} className="block h-1 max-w-56 overflow-hidden rounded-full bg-(--dp-track)">
                <span className="block h-full rounded-full bg-(--dp-primary)" style={{ width: `${Math.round(row.progress * 100)}%` }} />
              </span>
              <span className="mt-1 block text-[12px] text-(--dp-muted-fg)">{row.progressLabel}</span>
            </span>
          )}
        </dd>
        <dt className="text-(--dp-muted-fg)">Your role</dt>
        <dd>
          {roleLabel(row.role)}
          {row.isCreator ? " · creator" : ""}
        </dd>
        <dt className="text-(--dp-muted-fg)">People</dt>
        <dd>{row.people.length ? row.people.map((p) => `${p.name} (${roleLabel(p.role).toLowerCase()})`).join(", ") : "Only you so far"}</dd>
        <dt className="text-(--dp-muted-fg)">Updated</dt>
        <dd className="dp-mono text-[12px]">
          <When iso={row.updatedAt} now={now} />
        </dd>
        {others.length > 0 && (
          <>
            <dt className="text-(--dp-muted-fg)">Also here</dt>
            <dd>
              <ul className="space-y-1">
                {others.map((o) => (
                  <li key={o.kind}>
                    <Link href={o.href} className="font-medium text-(--dp-primary-fg) hover:underline">
                      {o.label}
                    </Link>
                    <span className="text-(--dp-muted-fg)"> · {o.reason}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/* ── Library: grouped list with filters ──────────────────────────────────── */

interface LibraryProps {
  ref: React.Ref<HTMLElement>;
  rows: DashboardRow[];
  visible: DashboardRow[];
  counts: Record<StatusFilter, number>;
  status: StatusFilter;
  side: SideFilter;
  query: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  now: Date | null;
  onStatus: (f: StatusFilter) => void;
  onSide: (s: SideFilter) => void;
  onQuery: (q: string) => void;
  onClear: () => void;
}

function Library({ ref, rows, visible, counts, status, side, query, searchRef, now, onStatus, onSide, onQuery, onClear }: LibraryProps) {
  const reduce = useReducedMotion();
  const groups = STAGES.map((s) => ({ stage: s, rows: visible.filter((r) => r.stage === s.id) })).filter((g) => g.rows.length);
  return (
    <section ref={ref} aria-labelledby="dp-library" className="min-w-0 scroll-mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dp-library" className="dp-title text-[19px] font-bold">
          All handovers
        </h2>
        <p className="text-[13px] text-(--dp-muted-fg)" aria-live="polite">
          Showing <span className="dp-mono">{visible.length}</span> of <span className="dp-mono">{rows.length}</span>
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-2.5 md:flex-row md:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search handovers</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--dp-muted-fg)" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search title, team or person"
            className="h-10 w-full rounded-lg border border-(--dp-input) bg-(--dp-card) pr-16 pl-9 text-[16px] placeholder:text-(--dp-muted-fg) sm:text-sm"
          />
          {query ? (
            <button type="button" onClick={() => onQuery("")} aria-label="Clear search" className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded hover:bg-(--dp-muted)">
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <kbd className="dp-kbd absolute top-1/2 right-2.5 hidden -translate-y-1/2 sm:inline-flex" aria-hidden="true">
              /
            </kbd>
          )}
        </label>
        <div role="radiogroup" aria-label="Whose handovers" className="inline-flex h-10 shrink-0 self-start rounded-lg border border-(--dp-border) bg-(--dp-sunken) p-0.5 md:self-auto">
          {SIDE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={side === f.id}
              onClick={() => onSide(f.id)}
              className={cn("rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors", side === f.id ? "bg-(--dp-card) text-(--dp-fg) shadow-(--dp-shadow)" : "text-(--dp-muted-fg) hover:text-(--dp-fg)")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Filter by status" className="dp-scroll-x -mx-4 mt-2.5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={status === f.id}
            onClick={() => onStatus(f.id)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
              status === f.id ? "bg-(--dp-fg) text-(--dp-bg)" : "text-(--dp-muted-fg) hover:bg-(--dp-muted) hover:text-(--dp-fg)",
            )}
          >
            {f.id !== "all" && f.id !== "attention" && <StageGlyph stage={f.id} className={status === f.id ? "text-current" : undefined} />}
            {f.label}
            <span className="dp-mono text-[12px] opacity-70">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-(--dp-border) bg-(--dp-card)">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Search className="size-5 text-(--dp-muted-fg)" aria-hidden="true" />
            <p className="font-semibold">No handovers match these filters</p>
            <p className="text-[13px] text-(--dp-muted-fg)">Try another word, or show everything again.</p>
            <button type="button" onClick={onClear} className="mt-2 h-9 rounded-full border border-(--dp-border-strong) px-4 text-sm font-medium hover:border-(--dp-primary) hover:text-(--dp-primary-fg)">
              Clear filters
            </button>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.stage.id} className="border-b border-(--dp-border) last:border-b-0">
              <h3 className="flex items-center gap-2 bg-(--dp-sunken) px-5 py-2 text-[12px] font-semibold text-(--dp-muted-fg)">
                <StageGlyph stage={g.stage.id} />
                {g.stage.label}
                <span className="dp-mono font-normal">{g.rows.length}</span>
              </h3>
              <ul className="divide-y divide-(--dp-border)">
                <AnimatePresence initial={false}>
                  {g.rows.map((r) => (
                    <motion.li
                      key={r.id}
                      layout={reduce ? false : "position"}
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? undefined : { opacity: 0 }}
                      transition={{ duration: 0.16 }}
                    >
                      <LibraryRow row={r} now={now} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function LibraryRow({ row, now }: { row: DashboardRow; now: Date | null }) {
  const names = row.people.map((p) => p.name.split(" ")[0]);
  return (
    <div className="group relative grid gap-x-6 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-(--dp-sunken) md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_5.5rem_4.5rem] md:items-center">
      <div className="min-w-0">
        <p className="truncate font-semibold">
          <Link href={row.href} className="after:absolute after:inset-0" aria-label={`${row.title}, ${row.team}. ${row.cta}`}>
            {row.title}
          </Link>
        </p>
        <p className="truncate text-[13px] text-(--dp-muted-fg)">
          {row.team} · {roleLabel(row.role)}
          {row.isCreator ? " · creator" : ""}
        </p>
      </div>
      <div className="min-w-0">
        <p className={cn("flex items-center gap-1.5 text-[13px]", row.health === "failed" ? "font-medium text-(--dp-danger-fg)" : row.attention.length ? "font-medium" : "text-(--dp-muted-fg)")}>
          {row.attention.length > 0 && row.health !== "failed" && <span className="size-1.5 shrink-0 rounded-full bg-(--dp-primary)" aria-hidden="true" />}
          {row.health === "failed" && <AlertOctagon className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{row.status}</span>
        </p>
        {row.progress !== null && (
          <span aria-hidden="true" className="mt-1.5 block h-[3px] max-w-52 overflow-hidden rounded-full bg-(--dp-track)">
            <span className="block h-full rounded-full bg-(--dp-primary)" style={{ width: `${Math.round(row.progress * 100)}%` }} />
          </span>
        )}
      </div>
      <p className="truncate text-[13px] text-(--dp-muted-fg)" title={row.people.map((p) => `${p.name} (${roleLabel(p.role)})`).join(", ")}>
        {names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")) : "Only you"}
      </p>
      <p className="dp-mono text-[12px] text-(--dp-muted-fg)">
        <When iso={row.updatedAt} now={now} />
      </p>
      <span className="dp-row-cue hidden items-center justify-end gap-1 text-[13px] font-semibold text-(--dp-primary-fg) md:flex" aria-hidden="true">
        {row.cta === "Open" ? "Open" : "Go"}
        <ArrowRight className="size-3.5" />
      </span>
    </div>
  );
}

/* ── Right rail: resume + timeline ───────────────────────────────────────── */

function Resume({ row, now }: { row: DashboardRow; now: Date | null }) {
  return (
    <section aria-labelledby="dp-resume">
      <h2 id="dp-resume" className="text-[12px] font-semibold text-(--dp-muted-fg)">
        Pick up where you left off
      </h2>
      <div className="mt-3 rounded-xl border border-(--dp-border) bg-(--dp-card) p-5 shadow-(--dp-shadow)">
        <p className="dp-mono text-[12px] text-(--dp-primary-fg)">
          ↳ {STAGES.find((s) => s.id === row.stage)?.label} · {row.team}
        </p>
        <p className="dp-title mt-1.5 text-[18px] leading-snug font-bold">{row.title}</p>
        <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-(--dp-muted-fg)">Next</dt>
          <dd>{row.status}</dd>
          {row.progressLabel && (
            <>
              <dt className="text-(--dp-muted-fg)">Progress</dt>
              <dd>
                <span aria-hidden="true" className="mb-1 block h-1 overflow-hidden rounded-full bg-(--dp-track)">
                  <span className="block h-full rounded-full bg-(--dp-primary)" style={{ width: `${Math.round((row.progress ?? 0) * 100)}%` }} />
                </span>
                {row.progressLabel}
              </dd>
            </>
          )}
          <dt className="text-(--dp-muted-fg)">Edited</dt>
          <dd className="dp-mono text-[12px]">
            <When iso={row.updatedAt} now={now} />
          </dd>
        </dl>
        <Link href={row.href} className="mt-5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-(--dp-primary) text-[13.5px] font-semibold text-(--dp-primary-fg) transition-colors hover:bg-(--dp-primary) hover:text-(--dp-on-primary)">
          {row.cta}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function Timeline({ items, now }: { items: ActivityItem[]; now: Date | null }) {
  // Grouping needs "today", so it waits for the client clock; the server renders one flat group.
  const groups = now ? groupActivityByDay(items, now) : [{ label: "Recent", items }];
  return (
    <section aria-labelledby="dp-activity">
      <h2 id="dp-activity" className="text-[12px] font-semibold text-(--dp-muted-fg)">
        Recent activity
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-[13px] text-(--dp-muted-fg)">Nothing has happened yet. Activity appears here as handovers move.</p>
      ) : (
        <div className="mt-3 space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="dp-mono text-[11px] tracking-wide text-(--dp-muted-fg) uppercase">{g.label}</p>
              <ol className="mt-2 border-l border-(--dp-border)">
                {g.items.map((a) => (
                  <li key={a.id} className="relative py-1.5 pl-4">
                    <span
                      aria-hidden="true"
                      className={cn("absolute top-3 -left-[4px] size-[7px] rounded-full ring-2 ring-(--dp-bg)", a.tone === "good" ? "bg-(--dp-success)" : a.tone === "bad" ? "bg-(--dp-danger)" : "bg-(--dp-border-strong)")}
                    />
                    <p className="text-[13px] leading-snug">
                      <span className="text-(--dp-muted-fg)">{a.text}</span>{" "}
                      <Link href={a.href} className="font-semibold hover:text-(--dp-primary-fg) hover:underline">
                        {a.handover}
                      </Link>
                    </p>
                    <p className="dp-mono text-[11px] text-(--dp-muted-fg)">
                      <When iso={a.at} now={now} />
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      <p className="mt-5 text-[12px] leading-relaxed text-(--dp-muted-fg)">Built from processing runs, gap answers and handover updates Baton already has. Nothing extra is tracked.</p>
    </section>
  );
}
