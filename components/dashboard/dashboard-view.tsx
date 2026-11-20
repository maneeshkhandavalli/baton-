import Link from "next/link";
import { AlertOctagon, ArrowRight, CheckCircle2, Crown, FilePen, Inbox, MessageCircleQuestion, Scale, ShieldAlert, UserPlus } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DashboardAutoRefresh } from "./dashboard-auto-refresh";
import { DraftRow } from "./draft-row";
import { HandoverCard, type HandoverCardData } from "./handover-card";
import { attentionByHandover, attentionQueue, hasRunningProcessing, type AttentionKind, type DashboardRow } from "./model";
import type { DashboardResult } from "./load";

const KIND_ICON: Record<AttentionKind, typeof Scale> = {
  offer: Crown,
  failed: AlertOctagon,
  conflicts: Scale,
  review: FilePen,
  gaps: MessageCircleQuestion,
  invite: UserPlus,
  publish: CheckCircle2,
  acknowledge: Inbox,
  privacy: ShieldAlert,
};

const isPreparing = (c: HandoverCardData) => c.handover.viewerRole === "outgoing" || c.handover.viewerRole === "reviewer";

interface UpNextItem {
  key: string;
  icon: typeof Scale;
  danger?: boolean;
  title: string;
  reason: string;
  /** Other things this handover needs, by label (the lead item's CTA covers the first). */
  also?: string[];
  cta: string;
  href: string;
}

/**
 * The one to three things worth doing first: the most urgent "needs you" items (from classify), and the draft you
 * last worked on when nothing more urgent is waiting. Hidden when there is nothing to do.
 */
export function upNextItems(cards: readonly HandoverCardData[], limit = 3): UpNextItem[] {
  const rows = cards.map((c) => c.row).filter((r): r is DashboardRow => !!r);
  const items: UpNextItem[] = attentionByHandover(attentionQueue(rows))
    .slice(0, limit)
    .map((a) => ({ key: `${a.handoverId}-${a.kind}`, icon: KIND_ICON[a.kind], danger: a.kind === "failed", title: a.title, reason: a.reason, also: a.also, cta: a.cta, href: a.href }));
  const lastDraft = cards.filter((c) => c.draft && isPreparing(c)).sort((a, b) => (a.handover.updatedAt < b.handover.updatedAt ? 1 : -1))[0];
  if (lastDraft && items.length < limit && !items.some((i) => i.key.startsWith(lastDraft.handover.id))) {
    items.push({ key: `${lastDraft.handover.id}-resume`, icon: FilePen, title: lastDraft.handover.title, reason: `Draft · next: ${lastDraft.draft!.next}.`, cta: "Continue where you left off", href: lastDraft.href });
  }
  return items;
}

function UpNext({ items, total }: { items: UpNextItem[]; total: number }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="up-next" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div data-tour="up-next" className="flex items-baseline justify-between gap-3 border-b border-border px-4 pt-5 pb-4 sm:px-6">
        <h2 id="up-next" className="font-display text-2xl leading-tight font-semibold tracking-[-0.02em]">
          Up next
        </h2>
        {total > items.length && <p className="text-sm text-muted-foreground">{total - items.length} more {total - items.length === 1 ? "handover needs" : "handovers need"} you below</p>}
      </div>
      <ul className="divide-y divide-border">
        {items.map((it, i) => (
          <li
            key={it.key}
            className={cn(
              "flex flex-col gap-3 px-4 transition-colors sm:flex-row sm:items-center sm:gap-5 sm:px-6",
              // The lead item is the next step: larger, tinted with the highlighter, and its action is the lime pill.
              i === 0 ? "bg-highlight/15 py-5" : "py-4 hover:bg-muted/50",
            )}
          >
            <span aria-hidden="true" className={cn("hidden size-10 shrink-0 place-items-center rounded-full border sm:grid", it.danger ? "border-destructive/40 text-destructive-fg" : "border-border-strong bg-card text-foreground")}>
              <it.icon className="size-[1.125rem]" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className={cn("font-semibold [overflow-wrap:anywhere]", i === 0 ? "text-lg leading-snug" : "text-md")}>{it.title}</p>
              <p className={cn("text-md", it.danger ? "font-medium text-destructive-fg" : "text-foreground/80")}>{it.reason}</p>
              {it.also && it.also.length > 0 && <p className="text-sm text-muted-foreground">Also needs: {it.also.map((l) => l.toLocaleLowerCase()).join(" · ")}</p>}
            </div>
            <Link
              href={it.href}
              aria-label={`${it.cta}: ${it.title}`}
              className={cn(
                buttonVariants({ variant: "outline", size: i === 0 ? "lg" : "default" }),
                "shrink-0 self-start sm:self-auto",
                i === 0 && "border-transparent bg-highlight font-semibold text-on-highlight hover:bg-highlight/80",
              )}
            >
              {it.cta}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CardGrid({ cards }: { cards: HandoverCardData[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 min-[1600px]:grid-cols-3">
      {cards.map((c) => (
        <li key={c.handover.id}>
          <HandoverCard data={c} />
        </li>
      ))}
    </ul>
  );
}

/**
 * First-run: one line on what a handover is, one way in, one way to look around. (UI polish: the three step cards
 * repeated the Getting Started checklist shown beside this.)
 */
function FirstRun({ newHandover, demoHref }: { newHandover: ReactNode; demoHref: string }) {
  return (
    <EmptyState
      icon={<Inbox />}
      title="No handovers yet"
      description="A handover gathers what your team knows into something the next person can trust."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {newHandover}
          <Link href={demoHref} className={buttonVariants({ size: "lg", variant: "outline" })}>
            Explore the demo
          </Link>
        </div>
      }
    />
  );
}

interface DashboardViewProps {
  result: DashboardResult;
  /** The "New handover" link (real route or preview route). */
  newHandover: ReactNode;
  demoHref: string;
  /** Preview: discard is disabled (no server actions). */
  preview?: boolean;
}

/** The dashboard body below the page header. Used by /dashboard and, with mock data, /preview/dashboard. */
export function DashboardView({ result, newHandover, demoHref, preview = false }: DashboardViewProps) {
  if (!result.ok) {
    return (
      <EmptyState
        tone="error"
        icon={<Inbox />}
        title="We couldn’t load your handovers"
        description="Nothing you saved is lost. Refresh the page to try again; if it keeps happening, sign out and back in."
      />
    );
  }
  const { cards } = result;
  if (cards.length === 0) return <FirstRun newHandover={newHandover} demoHref={demoHref} />;

  const drafts = cards.filter((c) => c.draft && isPreparing(c)).sort((a, b) => (a.handover.updatedAt < b.handover.updatedAt ? 1 : -1));
  // Work that needs the viewer first: offers to them, then anything with a "needs you" item, then by state.
  const rank = (c: HandoverCardData) =>
    c.handover.pendingCreatorTransfer && !c.handover.viewerIsCreator ? 0 : (c.row?.attention.length ?? 0) > 0 ? 1 : c.handover.state === "in_review" ? 2 : c.handover.state === "processing" ? 3 : 4;
  const preparing = cards.filter((c) => !c.draft && isPreparing(c)).sort((a, b) => rank(a) - rank(b));
  const receiving = cards.filter((c) => !isPreparing(c)).sort((a, b) => rank(a) - rank(b));
  const upNext = upNextItems(cards);
  const totalAttention = attentionByHandover(attentionQueue(cards.map((c) => c.row).filter((r): r is DashboardRow => !!r))).length;

  const processingNow = hasRunningProcessing(cards.map((c) => c.row).filter((r): r is DashboardRow => !!r));

  return (
    <div className="space-y-10 lg:space-y-12">
      {!preview && <DashboardAutoRefresh active={processingNow} />}
      <UpNext items={upNext} total={totalAttention} />
      {drafts.length > 0 && (
        <section aria-labelledby="drafts" className="space-y-4">
          <SectionHeading id="drafts" title="Drafts to finish" count={drafts.length} />
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {drafts.map((c) => (
              <DraftRow key={c.handover.id} data={c} preview={preview} />
            ))}
          </ul>
        </section>
      )}
      {preparing.length > 0 && (
        <section aria-labelledby="preparing" className="space-y-4">
          <SectionHeading id="preparing" title="Preparing and reviewing" count={preparing.length} />
          <CardGrid cards={preparing} />
        </section>
      )}
      {receiving.length > 0 && (
        <section aria-labelledby="receiving" className="space-y-4">
          <SectionHeading id="receiving" title="Handed over to you" count={receiving.length} />
          <CardGrid cards={receiving} />
        </section>
      )}
    </div>
  );
}
