"use client";

import { CircleHelp } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import type { EvidenceStatus } from "@/types/status";

/**
 * The hero's working example: the team chat on one side, the handover Baton drafts from it on the other. Choosing a
 * point (hover, focus or tap) highlights the exact messages it cites, with their line numbers. Fictional CodeCell
 * demo content (lib/demo/scenario; Priya Raman hands over to Neha Kulkarni, Kabir Shah reviews). Without JavaScript
 * or motion the default selection is shown, so the page is complete either way.
 */

const LINES = [
  { n: 13, t: "04/08/2026, 20:15", who: "Priya Raman", text: "workshop fee for this sem: non-members pay ₹100 per workshop, members free. collect it at the door and note names in the sheet" },
  { n: 15, t: "21/08/2026, 22:05", who: "Priya Raman", text: "vote closed 11–2. DevForge '27 is Sat 30 – Sun 31 Jan, 9am to 9pm both days. no overnight in the labs this time" },
  { n: 20, t: "18/09/2026, 21:10", who: "Kabir Shah", text: "from this sem workshops are free for everyone, we agreed in the leads call. no more ₹100 at the door" },
  { n: 22, t: "25/09/2026, 12:05", who: "Ananya Iyer", text: "can we do thursday this week instead? lab 3 is free after 6" },
  { n: 29, t: "16/10/2026, 11:20", who: "Rohan Pillai", text: "desai sir approved the workshop venue but he wants the form in person, not on email. his number is [PHONE_1] if it's urgent" },
  { n: 41, t: "02/11/2026, 16:00", who: "Priya Raman", text: "github org owners are me and kabir. recovery codes are in the club password manager, not in chat. i'll add neha as owner before i go" },
] as const;

interface Point {
  id: string;
  status: EvidenceStatus;
  title: string;
  note: string;
  lines: number[];
}

const POINTS: Point[] = [
  { id: "github", status: "sourced", title: "GitHub organisation owners", note: "Approved by Kabir", lines: [41] },
  { id: "devforge", status: "sourced", title: "DevForge 2027 runs on two days, daytime only", note: "Core team vote, 11–2", lines: [15] },
  { id: "fee", status: "conflicting", title: "Workshop fee for non-members", note: "Two messages disagree; a person decides", lines: [13, 20] },
  { id: "thursday", status: "inferred", title: "The weekly meeting is on Thursdays", note: "Suggested, never stated as a rule", lines: [22] },
  { id: "desai", status: "sourced", title: "Mr. Desai, Dean's office", note: "Contact; phone number masked", lines: [29] },
  { id: "discord", status: "missing", title: "Who runs the Discord server?", note: "No source; sent to the Gap Interview", lines: [] },
];

function MaskedLine({ text }: { text: string }) {
  const parts = text.split(/(\[PHONE_1\])/);
  return (
    <>
      {parts.map((p, i) =>
        p === "[PHONE_1]" ? (
          <span key={i} className="rounded-sm bg-foreground/10 px-1 font-mono text-[0.8em] text-muted-foreground">
            <span className="sr-only">masked phone number 1 </span>
            <span aria-hidden="true">[PHONE_1]</span>
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function EvidencePreview() {
  const [active, setActive] = useState("github");
  const point = POINTS.find((p) => p.id === active) ?? POINTS[0];

  return (
    <div className="grid overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[1.05fr_1fr]">
      {/* The handover Baton drafts */}
      <div className="lg:order-2 lg:border-l lg:border-border">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <p className="bi-h3">CodeCell · technical lead handover</p>
          <p className="bi-mono text-xs text-muted-foreground">Priya → Neha</p>
        </div>
        <ul aria-label="Points in the handover. Choose one to see the messages it cites." className="divide-y divide-border">
          {POINTS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={p.id === active}
                onMouseEnter={() => setActive(p.id)}
                onFocus={() => setActive(p.id)}
                onClick={() => setActive(p.id)}
                className="bi-point focus-ring grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-4 py-3 text-left outline-none sm:px-5"
              >
                <span className="row-span-2 pt-0.5">
                  {p.status === "missing" ? (
                    <CircleHelp aria-hidden="true" className="size-4 text-status-missing" />
                  ) : (
                    <StatusBadge status={p.status} size="sm" />
                  )}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {p.status === "missing" ? <span className="sr-only">Missing: </span> : null}
                  {p.title}
                </span>
                <span className="text-caption text-muted-foreground">
                  {p.note}
                  {p.lines.length > 0 ? <span className="bi-ref ml-2 whitespace-nowrap">↳ line {p.lines.join(", ")}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* The record it comes from */}
      <div className="border-t border-border bg-muted/50 lg:order-1 lg:border-t-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold">WhatsApp Chat with CodeCell Core Team 26-27</p>
          <p className="bi-mono shrink-0 text-xs text-muted-foreground">.txt export</p>
        </div>
        <ol
          aria-label="Messages from the exported chat. The cited ones are highlighted."
          className="bi-transcript space-y-1 px-2 py-3 sm:px-3"
          data-has-selection={point.lines.length > 0}
        >
          {LINES.map((l) => {
            const hit = point.lines.includes(l.n);
            return (
              <li key={l.n} data-hit={hit} className="bi-line grid grid-cols-[2.25rem_1fr] gap-2 rounded-md px-2 py-1.5">
                <span className="bi-mono pt-0.5 text-right text-xs text-faint-foreground tabular-nums">{l.n}</span>
                <span className="text-sm leading-relaxed">
                  <span className="bi-mono block text-xs text-muted-foreground">
                    {l.t} · {l.who}
                  </span>
                  <mark>
                    <MaskedLine text={l.text} />
                  </mark>
                </span>
              </li>
            );
          })}
        </ol>
        <p aria-live="polite" className={cn("border-t border-border px-4 py-2.5 text-caption text-muted-foreground sm:px-5")}>
          {point.lines.length > 0
            ? `${point.title}: cites line ${point.lines.join(" and ")}, matched word for word.`
            : `${point.title}: nobody wrote this down, so Baton asks the people who know.`}
        </p>
      </div>
    </div>
  );
}
