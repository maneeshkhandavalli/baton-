"use client";

import { CalendarClock, CalendarX2, CircleHelp } from "lucide-react";
import { useMemo, useState } from "react";

import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type { PublishedHandover } from "@/lib/contracts/dto";

import { buildTimeline, filterTimeline, type TimelineFilter, type TimelineGroup, type TimelineModel } from "./build-timeline";
import { TimelineRow } from "./timeline-row";

/**
 * Decision timeline (docs/product/decision-timeline-plan.md): the published points in the order they were first
 * said, grouped by month (India time, components/handover/format.ts). Read-only and built only from the
 * publication the viewer can already read (§8.4, §8.5).
 *
 * Rendered under the page's own h1 (handover header or demo title): the timeline title is an h2, months h3,
 * points h4, as in PublishedHandoverView.
 */
export function HandoverTimeline({ handover }: { handover: PublishedHandover }) {
  const model = useMemo(() => buildTimeline(handover), [handover]);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const dated = model.groups.filter((g) => g.kind === "month").reduce((n, g) => n + g.entries.length, 0);

  return (
    <section aria-labelledby="timeline-h" className="min-w-0 space-y-6" data-timeline>
      <header className="space-y-1.5">
        <h2 id="timeline-h" className="type-section-title">
          Timeline
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Each point sits on the date of the earliest message that supports it.{" "}
          {model.total > 0 && (
            <span className="tabular-nums">
              {dated} of {model.total} {model.total === 1 ? "point is" : "points are"} dated.
            </span>
          )}
        </p>
      </header>

      {model.total === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Nothing in this publication is visible to you yet.</p>
      ) : model.sections.length < 2 ? (
        <TimelineGroups groups={model.groups} />
      ) : (
        <Tabs variant="segmented" value={filter} onValueChange={(v) => setFilter(v as TimelineFilter)}>
          <TabsList aria-label="Show points from">
            <TabsTab value="all">
              All <span className="tabular-nums text-muted-foreground">{model.total}</span>
            </TabsTab>
            {model.sections.map((s) => (
              <TabsTab key={s.id} value={s.id}>
                {s.label} <span className="tabular-nums text-muted-foreground">{s.count}</span>
              </TabsTab>
            ))}
          </TabsList>
          {(["all", ...model.sections.map((s) => s.id)] as TimelineFilter[]).map((f) => (
            <TabsPanel key={f} value={f}>
              <TimelineGroups groups={filterTimeline(model, f)} />
            </TabsPanel>
          ))}
        </Tabs>
      )}
    </section>
  );
}

const GROUP_NOTE: Partial<Record<TimelineGroup["kind"], { icon: typeof CircleHelp; text: string }>> = {
  open_questions: { icon: CircleHelp, text: "Known gaps. Nobody could answer these before the handover, so they have no date." },
  undated: { icon: CalendarX2, text: "No dated message supports these (for example, document quotes or answers without a date)." },
};

function TimelineGroups({ groups }: { groups: TimelineModel["groups"] }) {
  return (
    <div className="space-y-8">
      {groups.map((g) => {
        const note = GROUP_NOTE[g.kind];
        const NoteIcon = note?.icon ?? CalendarClock;
        const headingId = `timeline-${g.key}-h`;
        return (
          <section key={g.key} aria-labelledby={headingId} className="space-y-3" data-timeline-group={g.key}>
            <div className="space-y-1">
              <h3 id={headingId} className="text-sm font-medium text-muted-foreground">
                {g.label}
                <span className="sr-only">
                  {", "}
                  {g.entries.length} {g.entries.length === 1 ? "point" : "points"}
                </span>
              </h3>
              {note && (
                <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
                  <NoteIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  {note.text}
                </p>
              )}
            </div>
            <ol className="relative space-y-2 before:absolute before:top-3 before:bottom-3 before:left-[0.6875rem] before:w-px before:bg-border">
              {g.entries.map((e) => (
                <TimelineRow key={e.id} entry={e} group={g.kind} />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
