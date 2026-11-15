import Link from "next/link";
import { ArrowRight, CircleHelp } from "lucide-react";

import { EvidencePreview } from "@/components/marketing/evidence-preview";
import { ForTheNerds } from "@/components/marketing/for-the-nerds";
import { HowItWorksSteps } from "@/components/marketing/how-it-works";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { statusConfig } from "@/config/status";
import { routes } from "@/lib/routes";
import { EVIDENCE_STATUSES } from "@/types/status";

/**
 * Landing page, identity preview ("Graphite & Highlighter", scoped to the marketing routes; see
 * docs/design/AI-SLOP-AUDIT.md). The page shows the product's idea instead of describing it: a message becomes a
 * checked point. Content: accurate product claims and the fictional CodeCell demo (lib/demo/scenario).
 */

/** What usually goes missing in a handover (the categories Baton extracts). */
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

export default function HomePage() {
  return (
    <>
      {/* ── Hero: a message becomes a checked point ─────────── */}
      <section aria-labelledby="hero-title" className="bi-wrap pt-14 pb-20 sm:pt-20 sm:pb-24">
        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-end lg:gap-16">
          <h1 id="hero-title" className="bi-display max-w-[17ch]">
            Hand over a project without losing what matters.
          </h1>
          <div>
            <p className="bi-lede max-w-[44ch]">
              Baton turns a team&rsquo;s WhatsApp chats and documents into a handover for the next person, where every decision, owner, task and risk
              links back to the message it came from.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={routes.handover.new} className={buttonVariants({ size: "lg" })}>
                Start a handover
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
              <Link href={routes.demo} className={buttonVariants({ size: "lg", variant: "outline" })}>
                Try the demo
              </Link>
            </div>
            <p className="mt-3 text-caption text-muted-foreground">The demo is a fictional college coding club. No sign-in needed.</p>
          </div>
        </div>

        <div className="mt-12 sm:mt-14">
          <EvidencePreview />
          <ul className="mt-4 grid gap-2 text-caption text-muted-foreground sm:grid-cols-3 sm:gap-6">
            <li>Personal details are masked before anything is stored or sent to AI.</li>
            <li>Every quote is matched word for word, then checked separately.</li>
            <li>Nothing is published until a person has reviewed it.</li>
          </ul>
        </div>
      </section>

      {/* ── The problem ──────────────────────────────────── */}
      <section aria-labelledby="problem-title" className="border-t border-border">
        <div className="bi-wrap grid gap-8 py-16 sm:py-20 lg:grid-cols-[1fr_2fr] lg:gap-16">
          <h2 id="problem-title" className="bi-h2">
            What leaves with the person who leaves.
          </h2>
          <ul className="grid gap-8 sm:grid-cols-3 sm:gap-6">
            {LOST.map((l) => (
              <li key={l.title}>
                <h3 className="bi-h3">{l.title}</h3>
                <p className="bi-body mt-2">{l.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────── */}
      <section id="how-it-works" aria-labelledby="how-title" className="border-t border-border bg-card">
        <div className="bi-wrap py-16 sm:py-20">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
            <h2 id="how-title" className="bi-h2">
              From the team chat to a handover, in four steps.
            </h2>
            <p className="bi-lede">Baton pulls out what the next person needs: decisions, owners, open tasks, deadlines, blockers, risks, contacts and account access.</p>
          </div>
          <HowItWorksSteps />
        </div>
      </section>

      {/* ── Evidence ─────────────────────────────────────── */}
      <section id="evidence" aria-labelledby="evidence-title" className="border-t border-border">
        <div className="bi-wrap py-16 sm:py-20">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
            <h2 id="evidence-title" className="bi-h2">
              Every point says how sure you can be.
            </h2>
            <p className="bi-lede">Baton never presents a guess as a fact. Each point carries one of four labels, worked out from the evidence rather than set by hand.</p>
          </div>

          <dl className="mt-10 border-b border-border">
            {EVIDENCE_STATUSES.map((s) => (
              <div key={s} className="grid gap-3 border-t border-border py-6 md:grid-cols-[9rem_1fr_1fr] md:gap-8">
                <dt>
                  <StatusBadge status={s} />
                  <span className="sr-only"> {statusConfig[s].description}</span>
                </dt>
                <dd className="bi-body">{EVIDENCE[s].meaning}</dd>
                <dd>
                  <p className="flex items-start gap-2 text-sm font-semibold">
                    {s === "missing" ? <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-missing" /> : null}
                    {EVIDENCE[s].example}
                  </p>
                  <p className="bi-ref mt-1">↳ {EVIDENCE[s].ref}</p>
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 grid gap-4 md:grid-cols-[9rem_1fr] md:gap-8">
            <h3 className="bi-h3">Sign-off</h3>
            <div>
              <p className="bi-body text-foreground">A person signs off before anything is published. Publishing stays locked while:</p>
              <ul className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {PUBLISH_GATES.map((g) => (
                  <li key={g} className="flex items-baseline gap-2.5 text-sm">
                    <span aria-hidden="true" className="inline-block size-2.5 shrink-0 translate-y-px rounded-full border-2 border-warning" />
                    <span className="first-letter:uppercase">{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Privacy ──────────────────────────────────────── */}
      <section id="privacy" aria-labelledby="privacy-title" className="border-t border-border bg-card">
        <div className="bi-wrap grid gap-10 py-16 sm:py-20 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div>
            <h2 id="privacy-title" className="bi-h2">
              Built for group chats full of phone numbers.
            </h2>
            <p className="bi-lede mt-4">
              Student and volunteer groups run on WhatsApp. Sharing those chats for a handover shouldn&rsquo;t mean sharing everyone&rsquo;s details. You confirm
              the group was told, and anyone can ask to be left out.
            </p>
            <dl className="mt-8 space-y-5">
              {PRIVACY.map((p) => (
                <div key={p.title}>
                  <dt className="bi-h3">{p.title}</dt>
                  <dd className="bi-body mt-1">{p.body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <figure className="self-start rounded-lg bg-muted/70 p-5 sm:p-6">
            <figcaption className="text-caption text-muted-foreground">One message from the fictional demo · Arjun Mehta · CodeCell Leads</figcaption>
            <p className="mt-5 text-caption font-semibold">As received</p>
            <p className="bi-mono mt-1.5 text-sm leading-relaxed text-muted-foreground">
              our contact at orbitstack is farah khan, partnerships manager. <s>farah.khan@example.org</s>, office line <s>99999 00010</s>
            </p>
            <p className="mt-5 text-caption font-semibold">As stored, and the only version AI ever sees</p>
            <p className="bi-mono mt-1.5 text-sm leading-relaxed">
              our contact at orbitstack is farah khan, partnerships manager. <span className="rounded-sm bg-foreground/10 px-1">[EMAIL_1]</span>, office line{" "}
              <span className="rounded-sm bg-foreground/10 px-1">[PHONE_1]</span>
            </p>
            <p className="mt-5 border-t border-border pt-3 text-caption text-muted-foreground">The original upload is deleted once processing succeeds.</p>
          </figure>
        </div>
      </section>

      <ForTheNerds />

      {/* ── Closing ──────────────────────────────────────── */}
      <section aria-labelledby="cta-title" className="border-t border-border">
        <div className="bi-wrap grid gap-8 py-20 sm:py-24 lg:grid-cols-[1.25fr_1fr] lg:items-end lg:gap-16">
          <h2 id="cta-title" className="bi-h2 max-w-[20ch]">
            The next person shouldn&rsquo;t have to start from scratch.
          </h2>
          <div>
            <p className="bi-body">See it working first: the CodeCell demo shows the review workspace and the handover the incoming lead receives.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={routes.handover.new} className={buttonVariants({ size: "lg" })}>
                Start a handover
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
              <Link href={routes.demo} className={buttonVariants({ size: "lg", variant: "outline" })}>
                Explore the CodeCell demo
              </Link>
            </div>
            <p className="mt-3 text-caption text-muted-foreground">No sign-in for the demo · Fictional data only · Read-only</p>
          </div>
        </div>
      </section>
    </>
  );
}
