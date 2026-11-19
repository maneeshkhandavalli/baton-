import type { CSSProperties } from "react";
import { Check, CircleHelp, Lock } from "lucide-react";

import { ComingNext } from "@/components/marketing/coming-next";
import { LandingCtas } from "@/components/marketing/cta";
import { EvidencePreview } from "@/components/marketing/evidence-preview";
import { ForTheNerds } from "@/components/marketing/for-the-nerds";
import { HowItWorksSteps } from "@/components/marketing/how-it-works";
import { LivingHandover } from "@/components/marketing/living-handover";
import { StatusBadge } from "@/components/shared/status-badge";
import { statusConfig } from "@/config/status";
import { EVIDENCE_STATUSES } from "@/types/status";

/**
 * Landing page, identity preview ("Graphite & Highlighter", scoped to the marketing routes; see
 * docs/design/AI-SLOP-AUDIT.md), Round 4 redesign (docs/landing/loopsii-analysis.md): large tight type, soft round
 * surfaces, pill calls to action, a handwritten margin voice and short eased motion, all off under reduced motion.
 * The page shows the product instead of describing it: every illustration is a piece of Baton with the fictional
 * CodeCell demo data (lib/demo/scenario). Claims are the product's real behaviour; previews are labelled.
 */

/** Stagger index for the CSS entrance animations (.bi-rise, .bi-pop). */
const stagger = (n: number) => ({ "--d": n }) as CSSProperties;

/** What a handover carries (the categories Baton extracts). */
const CARRIES = ["Decisions", "Owners", "Open tasks", "Deadlines", "Blockers", "Risks", "Contacts", "Account access"] as const;

/** Week-one questions from the fictional CodeCell club; each one is a point (or a gap) in the demo handover. */
const WEEK_ONE = [
  { who: "Neha", text: "who has the login for the codecell.dev domain??", r: "-4deg", reply: false },
  { who: "Neha", text: "did we ever decide the workshop fee for non-members", r: "3deg", reply: false },
  { who: "Neha", text: "is DevForge one day or two this time?", r: "-2deg", reply: false },
  { who: "Kabir", text: "it's somewhere in the chat, scroll up", r: "4deg", reply: true },
  { who: "Neha", text: "who even runs the discord server", r: "-3deg", reply: false },
] as const;

/** What usually goes missing in a handover. */
const LOST = [
  { title: "Decisions and why", body: "Buried in months of group chat, with the reasoning scattered across replies." },
  { title: "Who owns what", body: "Owners, deadlines and account access that only the outgoing person remembers." },
  { title: "What nobody wrote down", body: "The gaps the next person discovers in their first week, the hard way." },
] as const;

/** What each label means, with one real point from the CodeCell demo. */
const EVIDENCE = {
  sourced: {
    meaning: "A quote that exists word for word in the source, checked separately to make sure it backs the claim.",
    example: "DevForge 2027 runs on two days, daytime only",
    ref: "Priya Raman · 21 Aug 2026 · Core Team 26-27 · line 15",
  },
  inferred: {
    meaning: "A reasonable reading with no quote that states it outright. A reviewer must confirm it before it's published.",
    example: "The weekly meeting is on Thursdays",
    ref: "3 messages mention it; none states it as a rule",
  },
  conflicting: {
    meaning: "Sources disagree. Both sides stay visible, newest first, until a person records what's true now.",
    example: "Workshop fee for non-members",
    ref: "Priya, 4 Aug: ₹100 · Kabir, 18 Sep: free for everyone",
  },
  missing: {
    meaning: "Something a handover should cover that nobody wrote down. It becomes a Gap Interview question.",
    example: "Who runs the Discord server?",
    ref: "No source · sent to the Gap Interview",
  },
} as const;

/** Mirrors the publish readiness check (lib/contracts/dto.ts READINESS_BLOCKERS, the review gates). */
const PUBLISH_GATES = [
  "a point is still waiting for review",
  "an inferred point is unconfirmed",
  "a conflict is unresolved",
  "a required gap question is unanswered",
] as const;

const PRIVACY = [
  { title: "Masked first", body: "Phone numbers, emails, UPI handles, bank details, IDs and passwords are masked before anything is stored or sent to AI." },
  { title: "Raw files deleted", body: "Uploads are deleted as soon as processing succeeds. Only masked, permitted evidence is kept." },
  { title: "Access by source", body: "Mark a chat as leads-only or reviewer-only, and every point drawn from it inherits that restriction." },
] as const;

const TRUST = [
  "Personal details are masked before anything is stored or sent to AI.",
  "Every quote is matched word for word, then checked separately.",
  "Nothing is published until a person has reviewed it.",
] as const;

function Token({ children }: { children: string }) {
  return <span className="bi-mono rounded-md bg-[var(--highlight)] px-1.5 py-px text-[0.85em] text-[var(--on-highlight)]">{children}</span>;
}

/** Section opener: tag, heading and lede, the heading on the left and the lede on the right from lg up. */
function SectionHead({ tag, id, title, lede }: { tag: string; id: string; title: React.ReactNode; lede: string }) {
  return (
    <div className="reveal grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
      <div>
        <p className="bi-tag">{tag}</p>
        <h2 id={id} className="bi-h2 mt-4">
          {title}
        </h2>
      </div>
      <p className="bi-lede">{lede}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      {/* ── Hero: a message becomes a checked point ─────────── */}
      <section aria-labelledby="hero-title" className="pt-10 pb-12 sm:pt-16 sm:pb-16">
        <div className="bi-wrap relative">
          <p className="bi-tag bi-rise" style={stagger(0)}>
            <span className="sm:hidden">For clubs, project teams and volunteers</span>
            <span className="hidden sm:inline">Handovers for student clubs, project teams and volunteer groups</span>
          </p>
          <h1 id="hero-title" className="bi-display bi-rise mt-6 max-w-[15ch]" style={stagger(1)}>
            Hand over a project without losing <span className="bi-swipe">what matters</span>.
          </h1>

          {/* A receipt, pinned beside the headline (wide screens only; the same point is in the preview below). */}
          <div aria-hidden="true" className="bi-pop absolute top-16 right-0 hidden w-64 xl:block" style={stagger(6)}>
            <div className="bi-card bi-sticker p-4 shadow-raised [--r:4deg]">
              <StatusBadge status="sourced" size="sm" />
              <p className="mt-2 text-sm font-semibold">GitHub organisation owners</p>
              <p className="bi-ref mt-1">↳ Priya · 2 Nov · line 41</p>
            </div>
            <p className="bi-hand mt-3 rotate-[-4deg] pl-6">every point has a receipt</p>
          </div>

          <div className="mt-8 grid gap-8 lg:mt-12 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-16">
            <p className="bi-lede bi-rise max-w-[46ch]" style={stagger(2)}>
              Baton turns a team&rsquo;s WhatsApp chats and documents into a handover for the next person, where every decision, owner, task and risk
              links back to the message it came from.
            </p>
            <div className="bi-rise" style={stagger(3)}>
              <LandingCtas />
              <p className="mt-3 text-caption text-muted-foreground">The demo is a fictional college coding club. No sign-in needed.</p>
            </div>
          </div>

          <ul aria-label="What a handover carries" className="mt-10 flex flex-wrap gap-2">
            {CARRIES.map((c, i) => (
              <li key={c} className="bi-pop rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium" style={stagger(i)}>
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div className="bi-wide bi-rise mt-12 sm:mt-16" style={stagger(5)}>
          <div className="bi-blueprint px-2 pt-3 pb-2 sm:px-6 sm:pt-5 sm:pb-6 lg:px-10 lg:pb-10">
            <div aria-hidden="true" className="flex items-baseline justify-between gap-4 px-2 pb-3 sm:px-0">
              <span className="bi-corner">Fig. 1 · Chat → handover</span>
              <span className="bi-corner hidden sm:inline">CodeCell demo · fictional</span>
            </div>
            <div aria-hidden="true" className="hidden pb-3 lg:grid lg:grid-cols-[1.05fr_1fr]">
              <p className="bi-hand rotate-[-2deg]">the exact line it came from ↓</p>
              <p className="bi-hand rotate-[2deg] pl-5">hover or tap a point ↓</p>
            </div>
            <p aria-hidden="true" className="bi-hand rotate-[-2deg] px-2 pb-3 lg:hidden">
              tap a point to see its source ↓
            </p>
            <EvidencePreview />
          </div>
        </div>
        <ul className="bi-wrap mt-8 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3 sm:gap-6">
          {TRUST.map((t) => (
            <li key={t} className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--highlight)] text-[var(--on-highlight)]">
                <Check className="size-3" strokeWidth={3} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      {/* ── The problem ──────────────────────────────────── */}
      <section aria-labelledby="problem-title" className="py-16 sm:py-24">
        <div className="bi-wrap">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
            <div className="reveal">
              <p className="bi-tag">The problem</p>
              <h2 id="problem-title" className="bi-h2 mt-4 max-w-[14ch]">
                What leaves with the person who leaves.
              </h2>
              <p className="bi-lede mt-5 max-w-[44ch]">
                The next lead inherits months of group chat and a few half-finished documents. The answers are in there somewhere, scattered across
                replies.
              </p>
            </div>
            <figure className="bi-stage reveal px-4 py-8 sm:px-8 sm:py-10">
              <figcaption className="bi-hand rotate-[-2deg]">week one, in the new lead&rsquo;s DMs</figcaption>
              <ul aria-label="Questions a new lead asks in week one" className="mt-5 flex flex-col gap-3">
                {WEEK_ONE.map((m) => (
                  <li
                    key={m.text}
                    className={`bi-sticker w-fit max-w-[85%] rounded-2xl px-4 py-3 text-[0.9375rem] leading-snug shadow-soft odd:self-start even:self-end sm:max-w-[20rem] ${
                      m.reply ? "rounded-br-md bg-[var(--highlight)] text-[var(--on-highlight)]" : "rounded-bl-md bg-card"
                    }`}
                    style={{ "--r": m.r } as CSSProperties}
                  >
                    <span className="bi-mono block text-xs opacity-70">{m.who}</span>
                    {m.text}
                  </li>
                ))}
              </ul>
            </figure>
          </div>

          <ul className="reveal-group mt-14 grid gap-5 sm:grid-cols-3 lg:gap-6">
            {LOST.map((l, i) => (
              <li key={l.title} className="bi-card p-6">
                <span className="bi-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="bi-h3 mt-3 text-[1.25rem]">{l.title}</h3>
                <p className="bi-body mt-2">{l.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────── */}
      <section id="how-it-works" aria-labelledby="how-title" className="py-16 sm:py-24">
        <div className="bi-wrap">
          <SectionHead
            tag="How it works"
            id="how-title"
            title="From the team chat to a handover, in four steps."
            lede="Baton pulls out what the next person needs: decisions, owners, open tasks, deadlines, blockers, risks, contacts and account access."
          />
          <HowItWorksSteps />
        </div>
      </section>

      {/* ── Evidence ─────────────────────────────────────── */}
      <section id="evidence" aria-labelledby="evidence-title" className="py-16 sm:py-24">
        <div className="bi-wrap">
          <SectionHead
            tag="Evidence"
            id="evidence-title"
            title={
              <>
                Every point says how <span className="bi-swipe">sure</span> you can be.
              </>
            }
            lede="Baton never presents a guess as a fact. Each point carries one of four labels, worked out from the evidence rather than set by hand."
          />

          <dl className="reveal-group mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {EVIDENCE_STATUSES.map((s) => (
              <div key={s} className="bi-card bi-lift flex min-w-0 flex-col p-5 sm:p-6">
                <dt>
                  <StatusBadge status={s} />
                  <span className="sr-only"> {statusConfig[s].description}</span>
                </dt>
                <dd className="bi-body mt-4 mb-5 text-sm">{EVIDENCE[s].meaning}</dd>
                <dd className="bi-inset mt-auto p-4">
                  <p className="flex items-start gap-2 text-sm font-semibold">
                    {s === "missing" ? <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-missing" /> : null}
                    {EVIDENCE[s].example}
                  </p>
                  <p className="bi-ref mt-1.5">↳ {EVIDENCE[s].ref}</p>
                </dd>
              </div>
            ))}
          </dl>

          <div className="bi-stage reveal mt-6 grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
            <div>
              <h3 className="bi-h3 text-[1.5rem]">Sign-off</h3>
              <p className="bi-body mt-2 max-w-[42ch]">A person signs off before anything is published. Publishing stays locked while:</p>
            </div>
            <div className="bi-card p-5 shadow-soft sm:p-6">
              <ul className="space-y-2.5">
                {PUBLISH_GATES.map((g) => (
                  <li key={g} className="flex items-baseline gap-3 text-sm">
                    <span aria-hidden="true" className="inline-block size-3 shrink-0 translate-y-px rounded-full border-2 border-warning" />
                    <span className="first-letter:uppercase">{g}</span>
                  </li>
                ))}
              </ul>
              <p aria-hidden="true" className="mt-5 inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground">
                <Lock className="size-3.5" />
                Publish handover
              </p>
            </div>
          </div>
        </div>
      </section>

      <LivingHandover />

      {/* ── Privacy ──────────────────────────────────────── */}
      <section id="privacy" aria-labelledby="privacy-title" className="py-16 sm:py-24">
        <div className="bi-wrap grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div className="reveal">
            <p className="bi-tag">Privacy</p>
            <h2 id="privacy-title" className="bi-h2 mt-4">
              Built for group chats full of phone numbers.
            </h2>
            <p className="bi-lede mt-5">
              Student and volunteer groups run on WhatsApp. Sharing those chats for a handover shouldn&rsquo;t mean sharing everyone&rsquo;s details. You confirm
              the group was told, and anyone can ask to be left out.
            </p>
            <dl className="mt-10 grid gap-6 sm:grid-cols-3 lg:grid-cols-1">
              {PRIVACY.map((p) => (
                <div key={p.title} className="border-t border-border pt-4">
                  <dt className="bi-h3">{p.title}</dt>
                  <dd className="bi-body mt-1">{p.body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <figure className="bi-stage reveal self-start p-3 sm:p-5">
            <figcaption className="px-2 pt-1 pb-3 text-caption text-muted-foreground">One message from the fictional demo · Arjun Mehta · CodeCell Leads</figcaption>
            <div className="bi-card p-5 sm:p-6">
              <p className="bi-mono text-xs text-muted-foreground">As received</p>
              <p className="bi-mono mt-2 text-sm leading-relaxed text-muted-foreground">
                our contact at orbitstack is farah khan, partnerships manager. <s>farah.khan@example.org</s>, office line <s>99999 00010</s>
              </p>
            </div>
            <p aria-hidden="true" className="bi-hand rotate-[-2deg] px-3 py-3">
              masked before it&rsquo;s stored ↓
            </p>
            <div className="bi-card p-5 shadow-soft sm:p-6">
              <p className="bi-mono text-xs text-muted-foreground">As stored, and the only version AI ever sees</p>
              <p className="bi-mono mt-2 text-sm leading-relaxed">
                our contact at orbitstack is farah khan, partnerships manager. <Token>[EMAIL_1]</Token>, office line <Token>[PHONE_1]</Token>
              </p>
            </div>
            <p className="px-2 pt-3 pb-1 text-caption text-muted-foreground">The original upload is deleted once processing succeeds.</p>
          </figure>
        </div>
      </section>

      <ForTheNerds />

      {/* ── Previews (not available yet) ─────────────────── */}
      <ComingNext />

      {/* ── Closing: the page's one full-bleed colour moment ── */}
      <section aria-labelledby="cta-title" className="bi-lime">
        <div className="bi-wrap reveal grid gap-10 py-20 sm:py-28 lg:grid-cols-[1.3fr_1fr] lg:items-end lg:gap-16">
          <h2 id="cta-title" className="bi-display max-w-[16ch] text-[clamp(2.4rem,1.4rem+3.6vw,5rem)]">
            The next person shouldn&rsquo;t have to start from scratch.
          </h2>
          <div>
            <p className="bi-body text-[1.0625rem]">See it working first: the CodeCell demo shows the review workspace and the handover the incoming lead receives.</p>
            <LandingCtas demoLabel="Explore the CodeCell demo" className="mt-6" />
            <p className="mt-3 text-caption text-muted-foreground">No sign-in for the demo · Fictional data only · Nothing is saved or sent</p>
          </div>
        </div>
      </section>
    </>
  );
}
