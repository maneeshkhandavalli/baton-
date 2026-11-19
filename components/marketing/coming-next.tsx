import { ArrowRight, MessagesSquare, Send } from "lucide-react";
import type { ReactNode } from "react";

import { PreviewLabel } from "@/components/marketing/preview-label";

/**
 * "Coming next" on the landing page: Discord and Telegram bots, and Ask the Handover. (The Living Handover preview
 * sits with what already works for keeping a handover current: components/marketing/living-handover.tsx.)
 * VISUAL PREVIEWS ONLY. None of these exist yet: there is no bot and no question answering in the product, so
 * nothing here is interactive and every block carries a "Preview" label. Content is the fictional CodeCell scenario
 * used by the demo (Priya → Neha, Kabir reviewing).
 */

function Pane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-background">
      <p className="bi-mono border-b border-border px-3.5 py-2 text-xs text-muted-foreground">{label}</p>
      <div className="space-y-1.5 px-3.5 py-3 text-[0.8125rem] leading-snug">{children}</div>
    </div>
  );
}

function Msg({ who, children, bot = false }: { who: string; children: ReactNode; bot?: boolean }) {
  return (
    <p className="min-w-0 break-words">
      <span className={bot ? "font-semibold" : "font-medium text-muted-foreground"}>{who}</span> <span>{children}</span>
    </p>
  );
}

/** Discord and Telegram side by side: the same command, the same structured reply. */
function BotsIllustration() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Pane label="Discord · #core-team">
          <Msg who="Priya">
            <code className="bi-mono text-xs">/handover technical lead → Neha</code>
          </Msg>
          <Msg who="Baton" bot>
            Reading 4,210 messages from #core-team and #infra…
          </Msg>
        </Pane>
        <Pane label="Telegram · CodeCell Leads">
          <Msg who="Kabir">
            <code className="bi-mono text-xs">/handover sponsor relations → Neha</code>
          </Msg>
          <Msg who="Baton" bot>
            Reading 1,032 messages from this group…
          </Msg>
        </Pane>
      </div>
      <div className="rounded-2xl border border-border bg-background px-3.5 py-3 text-[0.8125rem]">
        <p className="font-semibold">Draft ready for review · 18 points</p>
        <ul className="mt-1.5 space-y-1 text-muted-foreground">
          <li>Decision · DevForge 2027 runs on two days, daytime only <span className="bi-ref">↳ #core-team · 21 Aug</span></li>
          <li>Owner · Kabir owns sponsor relations <span className="bi-ref">↳ Leads · 2 Sep</span></li>
        </ul>
        <p className="mt-1.5 text-caption text-muted-foreground">Personal details masked first; nothing is published until a person reviews it.</p>
      </div>
    </div>
  );
}

/** A recipient asks; every answer cites the messages it rests on, or says it doesn't know. */
function AskIllustration() {
  return (
    <div className="space-y-2.5 text-[0.8125rem] leading-snug">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-background">Who can renew the codecell.dev domain, and when is it due?</p>
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-background px-3.5 py-2.5">
        <p>
          Renewal is due on <strong>30 Nov 2026</strong>. Priya holds the registrar login today; the handover asks her to move billing to the club card
          before she leaves.
        </p>
        <p className="bi-ref mt-1.5">↳ infra-notes.md · Domains · line 12 &nbsp;·&nbsp; ↳ Core Team 26-27 · 9 Oct</p>
      </div>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-background">Who runs the Discord server?</p>
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-dashed border-border-strong px-3.5 py-2.5 text-muted-foreground">
        No source says. This is still an open question in the handover&rsquo;s Gap Interview.
      </div>
    </div>
  );
}

const PREVIEWS = [
  {
    id: "bots",
    icon: Send,
    title: "Discord and Telegram bots",
    body: "Type /handover in the group where the work happens. Baton reads the channel, masks personal details and drafts the same source-backed handover.",
    figure: <BotsIllustration />,
  },
  {
    id: "ask",
    icon: MessagesSquare,
    title: "Ask the Handover",
    body: "The incoming person asks in plain words. Answers come only from the handover and its sources, each with its references, and say so when nothing covers it.",
    figure: <AskIllustration />,
  },
] as const;

export function ComingNext() {
  return (
    <section id="coming-next" aria-labelledby="coming-next-title" className="py-20 sm:py-28">
      <div className="bi-wrap">
        <div className="reveal grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <div>
            <p className="bi-tag" data-tone="preview">
              Coming next
            </p>
            <h2 id="coming-next-title" className="bi-h2 mt-4">
              Where handovers go next.
            </h2>
          </div>
          <p className="bi-lede">
            Two more ideas we&rsquo;re building towards. These are previews with invented CodeCell content, not features you can use today.
          </p>
        </div>

        <ul className="reveal-group mt-12 grid gap-5 lg:grid-cols-[1.25fr_1fr] lg:gap-6">
          {PREVIEWS.map((p) => (
            <li key={p.id} aria-labelledby={`coming-${p.id}`} className="bi-card flex min-w-0 flex-col border-dashed bg-transparent p-5 sm:p-8">
              <PreviewLabel />
              <h3 id={`coming-${p.id}`} className="bi-h3 mt-4 flex items-center gap-2 text-[1.375rem]">
                <p.icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                {p.title}
              </h3>
              <p className="bi-body mt-2">{p.body}</p>
              <figure className="bi-stage mt-6 p-3 sm:p-4" aria-label={`${p.title}: illustrative preview`}>
                {p.figure}
              </figure>
            </li>
          ))}
        </ul>

        <p className="mt-10 flex items-center gap-2 text-caption text-muted-foreground">
          <ArrowRight aria-hidden="true" className="size-3.5" />
          Today, Baton works from WhatsApp exports and documents you upload. Try that in the demo.
        </p>
      </div>
    </section>
  );
}
