import { ArrowRight, CircleDot, MessagesSquare, RefreshCw, Send } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Round 3 previews on the landing page: Discord and Telegram bots, Ask the Handover, Living Handover.
 * VISUAL PREVIEWS ONLY. None of these exist yet: there is no bot, no question answering and no update tracking in
 * the product, so nothing here is interactive and every block carries a "Preview" label. Content is the fictional
 * CodeCell scenario used by the demo (Priya → Neha, Kabir reviewing).
 */

function PreviewLabel() {
  return (
    <span className="bi-mono inline-flex w-fit items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
      <CircleDot aria-hidden="true" className="size-3" />
      Preview
    </span>
  );
}

function Pane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background">
      <p className="bi-mono border-b border-border px-3 py-1.5 text-[0.6875rem] text-muted-foreground">{label}</p>
      <div className="space-y-1.5 px-3 py-2.5 text-[0.8125rem] leading-snug">{children}</div>
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
      <div className="rounded-md border border-border bg-card px-3 py-2.5 text-[0.8125rem]">
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
      <p className="ml-auto w-fit max-w-[85%] rounded-md bg-muted px-3 py-2">Who can renew the codecell.dev domain, and when is it due?</p>
      <div className="max-w-[92%] rounded-md border border-border bg-card px-3 py-2">
        <p>
          Renewal is due on <strong>30 Nov 2026</strong>. Priya holds the registrar login today; the handover asks her to move billing to the club card
          before she leaves.
        </p>
        <p className="bi-ref mt-1.5">↳ infra-notes.md · Domains · line 12 &nbsp;·&nbsp; ↳ Core Team 26-27 · 9 Oct</p>
      </div>
      <p className="ml-auto w-fit max-w-[85%] rounded-md bg-muted px-3 py-2">Who runs the Discord server?</p>
      <div className="max-w-[92%] rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground">
        No source says. This is still an open question in the handover&rsquo;s Gap Interview.
      </div>
    </div>
  );
}

/** New messages after publishing are matched against the handover and flagged for a person to review. */
function LivingIllustration() {
  const rows = [
    { tag: "Outdated", tone: "text-warning-fg", text: "Workshops are free for everyone", note: "Kabir, 3 Dec: “₹100 for non-members again from Jan”" },
    { tag: "Owner changed", tone: "text-foreground", text: "Venue bookings: Rohan → Ananya", note: "Rohan, 28 Nov: “ananya takes over bookings”" },
    { tag: "Done", tone: "text-success-fg", text: "Renew the codecell.dev domain", note: "Neha, 25 Nov: “renewed till 2027”" },
    { tag: "Needs review", tone: "text-muted-foreground", text: "New sponsor contact at Orbitstack", note: "Mentioned once; not yet in the handover" },
  ] as const;
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card text-[0.8125rem]">
      {rows.map((r) => (
        <li key={r.text} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[6.5rem_1fr] sm:gap-3">
          <span className={`bi-mono text-[0.6875rem] ${r.tone}`}>{r.tag}</span>
          <span className="min-w-0">
            <span className="font-medium">{r.text}</span>
            <span className="block truncate text-muted-foreground">{r.note}</span>
          </span>
        </li>
      ))}
    </ul>
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
  {
    id: "living",
    icon: RefreshCw,
    title: "Living Handover",
    body: "After publishing, new messages are checked against the handover. Outdated decisions, changed owners and finished tasks are flagged for a person to confirm.",
    figure: <LivingIllustration />,
  },
] as const;

export function ComingNext() {
  return (
    <section id="coming-next" aria-labelledby="coming-next-title" className="border-t border-border bg-card">
      <div className="bi-wrap py-16 sm:py-20">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
          <div>
            <p className="bi-mono text-xs text-muted-foreground">Coming in Round 3</p>
            <h2 id="coming-next-title" className="bi-h2 mt-2">
              Where handovers go next.
            </h2>
          </div>
          <p className="bi-lede">
            Three ideas we&rsquo;re building towards. These are previews with invented CodeCell content, not features you can use today.
          </p>
        </div>

        <ul className="mt-10 grid gap-x-8 gap-y-12 lg:grid-cols-3">
          {PREVIEWS.map((p) => (
            <li key={p.id} aria-labelledby={`coming-${p.id}`} className="flex min-w-0 flex-col">
              <PreviewLabel />
              <h3 id={`coming-${p.id}`} className="bi-h3 mt-3 flex items-center gap-2">
                <p.icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {p.title}
              </h3>
              <p className="bi-body mt-2 text-sm">{p.body}</p>
              <figure className="mt-4" aria-label={`${p.title}: illustrative preview`}>
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
