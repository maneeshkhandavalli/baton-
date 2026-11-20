"use client";

/**
 * Round 4 (Worker 02): the Getting Started checklist on the dashboard. Small, persistent and collapsible; every
 * tick comes from real application state (lib/onboarding/checklist.ts, loaded on the server), never from the tour.
 * Hidden when complete or dismissed; Help → "Getting started checklist" brings it back. The collapsed/expanded
 * choice is a per-browser convenience (localStorage); dismissal is saved with the user's guidance state.
 */

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleDashed,
  Clock3,
  Loader2,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import type {
  Checklist,
  ChecklistItem,
  ChecklistStatus,
} from "@/lib/onboarding/checklist";
import { cn } from "@/lib/utils";

import { useGuidance } from "./guidance";

const COLLAPSED_KEY = "baton.gettingStarted.collapsed";

const STATUS: Record<
  ChecklistStatus,
  { label: string; icon: typeof Circle; className: string }
> = {
  done: { label: "Done", icon: CheckCircle2, className: "text-success-fg" },
  in_progress: {
    label: "In progress",
    icon: Loader2,
    className: "text-primary-fg",
  },
  attention: {
    label: "Needs attention",
    icon: CircleAlert,
    className: "text-warning-fg",
  },
  todo: { label: "To do", icon: Circle, className: "text-muted-foreground" },
  waiting: {
    label: "Waiting for the team",
    icon: Clock3,
    className: "text-muted-foreground",
  },
  locked: {
    label: "Not available yet",
    icon: CircleDashed,
    className: "text-muted-foreground/70",
  },
};

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function ItemRow({ item, isNext }: { item: ChecklistItem; isNext: boolean }) {
  const s = STATUS[item.status];
  const Icon = s.icon;
  const muted = item.status === "done" || item.status === "locked";
  return (
    <li
      className={cn(
        "flex items-start gap-2.5 px-4 py-2.5",
        isNext && "bg-muted/70",
      )}
      aria-current={isNext ? "step" : undefined}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          s.className,
          item.status === "in_progress" &&
            "animate-spin motion-reduce:animate-none",
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            muted && "text-muted-foreground",
          )}
        >
          {item.label}
          <span className="sr-only">. {s.label}.</span>
        </p>
        <p className="text-caption text-muted-foreground">
          {item.status === "done" && (
            <span aria-hidden="true" className="font-medium text-success-fg">
              Done.{" "}
            </span>
          )}
          {item.detail}
        </p>
        {item.href && item.cta && item.status !== "done" && (
          <Link
            href={item.href}
            className={cn(
              buttonVariants({
                size: "sm",
                variant: isNext ? "default" : "outline",
              }),
              "mt-2 max-sm:h-10",
            )}
            // the tour card never covers the one next action
            data-tour-avoid={isNext ? "" : undefined}
            aria-label={`${item.cta}: ${item.label}`}
          >
            {item.cta}
            {isNext && <ArrowRight aria-hidden="true" data-icon="inline-end" />}
          </Link>
        )}
      </div>
    </li>
  );
}

export function GettingStartedView({
  checklist,
  forced = false,
  onDismiss,
}: {
  checklist: Checklist;
  forced?: boolean;
  onDismiss?: () => void;
}) {
  const listId = useId();
  const headingId = useId();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // per-browser convenience, read after mount (the server render is always expanded)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsed());
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // storage unavailable: the choice lasts for this page only
      }
      return !c;
    });
  };
  const pct = checklist.total
    ? Math.round((checklist.done / checklist.total) * 100)
    : 0;

  return (
    <section
      id="getting-started"
      aria-labelledby={headingId}
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div data-tour="checklist" className="rounded-t-2xl">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="font-display text-lg leading-snug font-semibold tracking-[-0.015em]">
              Getting started
            </h2>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {checklist.complete
                ? "All done. You can hide this list."
                : `${checklist.done} of ${checklist.total} done`}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground max-sm:h-10"
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={toggle}
          >
            {collapsed ? "Show" : "Hide"}
            <span className="sr-only"> steps</span>
            <ChevronDown
              aria-hidden="true"
              data-icon="inline-end"
              className={cn(
                "motion-safe:transition-transform",
                !collapsed && "rotate-180",
              )}
            />
          </Button>
          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground max-sm:h-10"
              onClick={onDismiss}
            >
              {forced && checklist.complete ? "Close" : "Dismiss"}
            </Button>
          )}
        </div>
        <div
          role="progressbar"
          aria-label="Getting started progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mx-4 mb-4 h-1.5 overflow-hidden rounded-full bg-track"
        >
          <div
            className={cn(
              "h-full rounded-full",
              checklist.complete ? "bg-success" : "bg-foreground",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {collapsed ? (
        checklist.next && (
          <div id={listId} className="border-t border-border">
            <ul>
              <ItemRow item={checklist.next} isNext />
            </ul>
          </div>
        )
      ) : (
        <ol
          id={listId}
          className="divide-y divide-border border-t border-border"
        >
          {checklist.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              isNext={checklist.next?.id === item.id}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/** The dashboard's checklist: hidden when dismissed (until Help reopens it) or complete (unless asked for). */
/** Fired by Help → "Getting started checklist" so a list hidden in this tab shows again. */
export const SHOW_CHECKLIST_EVENT = "baton:show-checklist";

export function GettingStarted({
  checklist,
  dismissed,
  forced,
}: {
  checklist: Checklist;
  dismissed: boolean;
  forced: boolean;
}) {
  const g = useGuidance();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const show = () => setHidden(false);
    window.addEventListener(SHOW_CHECKLIST_EVENT, show);
    return () => window.removeEventListener(SHOW_CHECKLIST_EVENT, show);
  }, []);
  if (hidden || (!forced && (dismissed || checklist.complete))) return null;
  return (
    <GettingStartedView
      checklist={checklist}
      forced={forced}
      onDismiss={() => {
        setHidden(true);
        g?.record({ type: "checklist_dismissed" });
      }}
    />
  );
}
