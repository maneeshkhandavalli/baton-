import type { CSSProperties } from "react";
import { CalendarClock, Check, Contact, Gavel, KeyRound, ListChecks, Lock, OctagonX, TriangleAlert, UserRound } from "lucide-react";

import { ComingNext } from "@/components/marketing/coming-next";
import { LandingCtas } from "@/components/marketing/cta";
import { EvidencePreview } from "@/components/marketing/evidence-preview";
import { ForTheNerds } from "@/components/marketing/for-the-nerds";
import { HeroMosaic } from "@/components/marketing/hero-mosaic";
import { HowItWorksSteps } from "@/components/marketing/how-it-works";
import { LandingMotion } from "@/components/marketing/landing-motion";
import { LivingHandover } from "@/components/marketing/living-handover";
import { PixelField } from "@/components/marketing/pixel-field";
import { RotatingWord } from "@/components/marketing/rotating-word";
import { StatusBadge } from "@/components/shared/status-badge";
import { EVIDENCE_STATUSES } from "@/types/status";

/**
 * Landing page, round 2 reconstruction of the Loopsii reference in Baton's identity
 * (docs/design/landing/loopsii-reference-breakdown.md; styles in app/(marketing)/landing.css; scroll choreography in
 * components/marketing/landing-motion.tsx, motion-allowed only). Section order follows the reference:
 * hero mosaic → statement + orbit → dark pinned band → lime band with the product window → stacked step cards →
 * stage tiles → split panels → roadmap wheel → FAQ → stair-stepped outro → closing card. Calls to action: the hero
 * and the closing card only (components/marketing/cta.tsx); the header carries the session's action.
 * Every illustration is a piece of Baton with the fictional CodeCell demo data (lib/demo/scenario). Claims are the
 * product's real behaviour; connectors are "Early access", Ask the Handover is a "Preview".
 */

/** What a handover carries (the categories Baton extracts): the orbit around the Baton disc. */
const CARRIES = [
  { label: "Decisions", Icon: Gavel, c: "var(--t-sky)", s: "rounded-[22%]", tilt: "-14deg" },
  { label: "Owners", Icon: UserRound, c: "var(--t-lime)", s: "rounded-full", tilt: "0deg" },
  { label: "Open tasks", Icon: ListChecks, c: "var(--t-stone)", s: "rounded-[22%]", tilt: "12deg" },
  { label: "Deadlines", Icon: CalendarClock, c: "var(--t-apricot)", s: "rounded-[22%]", tilt: "-24deg" },
  { label: "Blockers", Icon: OctagonX, c: "var(--t-mauve)", s: "rounded-full", tilt: "0deg" },
  { label: "Risks", Icon: TriangleAlert, c: "var(--t-lime-2)", s: "rounded-[22%]", tilt: "18deg" },
  { label: "Contacts", Icon: Contact, c: "var(--t-sky)", s: "rounded-full", tilt: "0deg" },
  { label: "Account access", Icon: KeyRound, c: "var(--t-apricot)", s: "rounded-[22%]", tilt: "-10deg" },
] as const;

/** Week-one questions from the fictional CodeCell club; each is a point (or a gap) in the demo handover. */
const WEEK_ONE = [
  { text: "who has the login for the codecell.dev domain??", tone: "faint" },
  { text: "did we ever decide the workshop fee for non-members", tone: "plain" },
  { text: "is DevForge one day or two this time?", tone: "plain" },
  { text: "when does the domain renew?", tone: "plain" },
  { text: "who's our contact at Orbitstack?", tone: "plain" },
  { text: "it's somewhere in the chat, scroll up", tone: "reply" },
  { text: "who even runs the discord server", tone: "plain" },
  { text: "do we still need Desai sir's form in person?", tone: "plain" },
  { text: "is the weekly meeting still thursday?", tone: "plain" },
  { text: "where are the github recovery codes?", tone: "faint" },
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
    tone: "var(--t-sky)",
    meaning: "A quote that exists word for word in the source, checked separately to make sure it backs the claim.",
    example: "DevForge 2027 runs on two days, daytime only",
    ref: "Priya Raman · 21 Aug 2026 · Core Team 26-27 · line 15",
  },
  inferred: {
    tone: "var(--t-apricot)",
    meaning: "A reasonable reading with no quote that states it outright. A reviewer must confirm it before it's published.",
    example: "The weekly meeting is on Thursdays",
    ref: "3 messages mention it; none states it as a rule",
  },
  conflicting: {
    tone: "var(--t-mauve)",
    meaning: "Sources disagree. Both sides stay visible, newest first, until a person records what's true now.",
    example: "Workshop fee for non-members",
    ref: "Priya, 4 Aug: ₹100 · Kabir, 18 Sep: free for everyone",
  },
  missing: {
    tone: "var(--t-stone)",
    meaning: "Something a handover should cover that nobody wrote down. It becomes a Gap Interview question.",
    example: "Who runs the Discord server?",
    ref: "No source · sent to the Gap Interview",
  },
} as const;

/** Mirrors the publish readiness check (lib/contracts/dto.ts READINESS_BLOCKERS, the review gates). */
const PUBLISH_GATES = [
  { text: "a point is still waiting for review", tone: "var(--t-lime-3)" },
  { text: "an inferred point is unconfirmed", tone: "var(--t-apricot)" },
  { text: "a conflict is unresolved", tone: "var(--t-mauve)" },
  { text: "a required gap question is unanswered", tone: "var(--t-stone)" },
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

/** Deterministic lime pixel backdrop for the receipt band (no randomness during render). */
const LIME_PIXELS = Array.from({ length: 16 * 12 }, (_, i) => {
  const v = (i * 2654435761) % 997;
  return v % 5 === 0 ? "var(--t-lime-2)" : v % 7 === 0 ? "var(--t-lime-3)" : v % 11 === 0 ? "color-mix(in srgb, var(--t-lime) 70%, #ffffff)" : "transparent";
});

const tone = (c: string) => ({ "--c": c }) as CSSProperties;

function Token({ children }: { children: string }) {
  return <span className="bi-mono rounded-md bg-[var(--highlight)] px-1.5 py-px text-[0.85em] text-[var(--on-highlight)]">{children}</span>;
}

/** Bold black shapes at the foot of each stage tile (reference: the feature tiles' geometric art). */
function TileArt({ kind }: { kind: string }) {
  const disc = "h-full aspect-square rounded-full bg-[#18181b]";
  if (kind === "sourced")
    return (
      <span aria-hidden="true" className="lp-ftile__art">
        <span className={disc} />
        <span className={disc} />
        <span className="h-[62%] w-[22%] self-start rounded-full bg-[#18181b]" />
      </span>
    );
  if (kind === "inferred")
    return (
      <span aria-hidden="true" className="lp-ftile__art">
        <span className={disc} />
        <span className={`${disc} opacity-55`} />
        <span className={`${disc} opacity-25`} />
      </span>
    );
  if (kind === "conflicting")
    return (
      <span aria-hidden="true" className="lp-ftile__art gap-[8%]">
        <span className="aspect-[1/2] h-full rounded-l-full bg-[#18181b]" />
        <span className="aspect-[1/2] h-full rounded-r-full bg-[#18181b]" />
      </span>
    );
  if (kind === "missing")
    return (
      <span aria-hidden="true" className="lp-ftile__art">
        <span className="h-full aspect-square rounded-full border-[3px] border-dashed border-[#18181b]" />
      </span>
    );
  return (
    <span aria-hidden="true" className="lp-ftile__art">
      <span className="h-[80%] aspect-square rounded-full border-[6px] border-[#18181b]" />
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="lp">
      <LandingMotion />

      <div className="lp-loop" data-loop>
        {/* ── 1 · Hero ─────────────────────────────── */}
        <section data-hero aria-labelledby="hero-title" className="lp-hero">
          <div className="lp-wrap lp-hero__text">
            <h1 id="hero-title" className="lp-display">
              <span className="sr-only">Hand over a project without losing what matters.</span>
              <span aria-hidden="true" data-hero-line className="lp-hero__line">
                <span>Hand over a project</span>
              </span>
              <span aria-hidden="true" data-hero-line className="lp-hero__line">
                <span>
                  without losing <RotatingWord words={["what matters.", "decisions.", "owners.", "deadlines."]} />
                </span>
              </span>
            </h1>
            <div>
              <p className="lp-lede max-w-[30ch]" data-hero-fade>
                Baton turns a team&rsquo;s WhatsApp chats and documents into a handover for the next person, where every decision, owner, task and risk links
                back to the message it came from.
              </p>
              <div data-hero-fade>
                <LandingCtas className="lp-hero__ctas" />
                <p className="mt-3 text-caption text-muted-foreground">The demo is a fictional college coding club. No sign-in needed.</p>
              </div>
            </div>
          </div>

          <div className="lp-frame">
            <div aria-hidden="true" className="lp-frame__labels">
              <span className="lp-mono">Sourced</span>
              <span className="lp-mono">Inferred</span>
            </div>
            <HeroMosaic />
            <div aria-hidden="true" className="lp-frame__labels lp-frame__labels--bottom">
              <span className="lp-mono">Conflicting</span>
              <span className="lp-mono">Missing</span>
            </div>
          </div>
        </section>

        {/* The Baton disc + the orbit of what a handover carries (sticky: rides from the hero into the intro). */}
        <div aria-hidden="true" className="lp-stage">
          <div className="lp-stage__center">
            <div className="lp-orbit" data-orbit>
              {CARRIES.map((c, i) => (
                <span
                  key={c.label}
                  className={`lp-orbit__item ${c.s}`}
                  style={{ "--c": c.c, "--a": `${(360 / CARRIES.length) * i}deg`, "--tilt": c.tilt } as CSSProperties}
                >
                  <c.Icon strokeWidth={2.25} />
                </span>
              ))}
            </div>
            <div className="lp-disc" data-disc>
              <span className="lp-disc__mark">
                <span className="bg-status-sourced" />
                <span className="bg-status-inferred" />
                <span className="bg-status-conflicting" />
                <span className="bg-status-missing" />
              </span>
            </div>
          </div>
        </div>

        {/* ── 2 · Intro: the statement ─────────────── */}
        <section data-intro aria-labelledby="problem-title" className="lp-intro lp-graph">
          <div className="lp-wrap lp-intro__head" data-intro-head data-reveal>
            <div className="lg:col-start-2">
              <h2 id="problem-title" className="sr-only">
                What leaves with the person who leaves.
              </h2>
              <p className="lp-statement max-w-[30ch]">
                The next lead inherits months of group chat and a few half-finished documents. The answers are in there somewhere, scattered across replies.
              </p>
            </div>
          </div>
          <div className="lp-intro__side lp-wrap">
            <p className="lp-lede">Baton pulls out what the next person needs:</p>
            <ul aria-label="What a handover carries" className="lp-body mt-2 flex flex-wrap gap-x-2 text-foreground max-lg:justify-center">
              {CARRIES.map((c, i) => (
                <li key={c.label}>
                  {c.label}
                  {i < CARRIES.length - 1 ? "," : "."}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* ── 3 · The problem: dark pinned band ─────── */}
      <section data-problem aria-label="Questions a new lead asks in week one" className="lp-problem">
        <div className="lp-problem__pin" data-header-tone="dark">
          <div className="lp-problem__panel" data-problem-panel>
            <div className="lp-problem__frame">
              <span aria-hidden="true" className="lp-tick" style={{ left: 0, top: 0 }} />
              <span aria-hidden="true" className="lp-tick" style={{ left: "100%", top: 0 }} />
              <span aria-hidden="true" className="lp-tick" style={{ left: 0, top: "100%" }} />
              <span aria-hidden="true" className="lp-tick" style={{ left: "100%", top: "100%" }} />
              <div className="lp-problem__grid">
                <p aria-hidden="true" className="lp-problem__a" data-problem-a>
                  What leaves
                  <br />
                  with
                </p>
                <div className="lp-problem__pills">
                  <span aria-hidden="true" className="lp-problem__paren" data-paren>
                    (
                  </span>
                  <ul className="contents">
                    {WEEK_ONE.map((m) => (
                      <li key={m.text} data-q className="lp-q" data-tone={m.tone}>
                        {m.text}
                      </li>
                    ))}
                  </ul>
                  <span aria-hidden="true" className="lp-problem__paren" data-paren>
                    )
                  </span>
                </div>
                <p aria-hidden="true" className="lp-problem__b" data-problem-b>
                  the person
                  <br />
                  who leaves
                </p>
                <ul className="lp-problem__lost" data-lost aria-label="What usually goes missing">
                  {LOST.map((l) => (
                    <li key={l.title}>
                      <strong>{l.title}</strong>
                      {l.body}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 · Every point has a receipt: lime band + product window ─ */}
      <section data-receipt aria-labelledby="receipt-title" className="lp-receipt">
        <div className="lp-receipt__sticky">
          <div aria-hidden="true" className="lp-pixels">
            {LIME_PIXELS.map((c, i) => (
              <span key={i} style={{ "--px": c } as CSSProperties} />
            ))}
          </div>
          <h2 id="receipt-title" data-receipt-title className="lp-h2 lp-receipt__title">
            Every point has a receipt.
          </h2>
        </div>
        <div className="lp-receipt__body">
          <div className="lp-window-wrap">
            <div aria-hidden="true" className="lp-window-fan max-lg:hidden" data-fan>
              <span style={tone("var(--t-sky)")} />
              <span style={tone("var(--t-mauve)")} />
              <span style={tone("var(--t-apricot)")} />
            </div>
            <div aria-hidden="true" className="lp-window-fan lp-window-fan--low max-lg:hidden">
              <span style={tone("var(--t-stone)")} />
              <span style={tone("var(--t-apricot)")} />
            </div>
            <figure className="lp-window" data-window aria-label="Example: a chat and the handover Baton drafts from it">
              <div aria-hidden="true" className="lp-window__bar">
                <span className="lp-mono text-muted-foreground">Fig. 1 · Chat → handover</span>
                <span className="lp-hand hidden text-[1.5rem] md:inline">hover or tap a point ↓</span>
                <span className="lp-mono text-muted-foreground max-sm:hidden">CodeCell demo · fictional</span>
              </div>
              <EvidencePreview />
            </figure>
          </div>
        </div>
      </section>
      <div className="lp-receipt__after">
        <ul className="mx-auto grid max-w-[calc(1400*var(--u))] gap-3 text-sm text-muted-foreground max-lg:max-w-[44rem] sm:grid-cols-3 sm:gap-6">
          {TRUST.map((t) => (
            <li key={t} className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--highlight)] text-[var(--on-highlight)]">
                <Check className="size-3" strokeWidth={3} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>

      {/* ── 5 · How it works: stacked cards ───────── */}
      <section id="how-it-works" aria-labelledby="how-title" className="lp-steps">
        <div className="lp-steps__head" data-reveal>
          <h2 id="how-title" className="lp-h2 mx-auto max-w-[18ch]">
            From the team chat to a handover, in four steps.
          </h2>
        </div>
        <HowItWorksSteps />
      </section>

      {/* ── 6 · Evidence: stage tiles ─────────────── */}
      <section id="evidence" aria-labelledby="evidence-title" className="lp-features lp-wrap">
        <div data-reveal>
          <h2 id="evidence-title" className="lp-h2 max-w-[16ch]">
            Every point says how sure you can be.
          </h2>
        </div>

        <div className="lp-stage-group">
          <div className="lp-stage-group__head">
            <h3 className="lp-h3 max-w-[18ch] text-[max(1.25rem,calc(34*var(--u)))]">Four labels, worked out from the evidence.</h3>
            <p className="lp-body mt-3 max-w-[36ch]">
              Baton never presents a guess as a fact, and nobody sets a label by hand.
            </p>
          </div>
          <dl className="lp-tiles">
            {EVIDENCE_STATUSES.map((s) => (
              <div key={s} className="lp-ftile" style={tone(EVIDENCE[s].tone)}>
                <dt className="flex flex-wrap items-center justify-between gap-2">
                  <span className="lp-ftile__title capitalize">{s}</span>
                  <StatusBadge status={s} size="sm" />
                </dt>
                <dd className="lp-ftile__body">{EVIDENCE[s].meaning}</dd>
                <dd className="lp-ftile__ref">
                  <span className="font-semibold">{EVIDENCE[s].example}</span>
                  <br />↳ {EVIDENCE[s].ref}
                </dd>
                <TileArt kind={s} />
              </div>
            ))}
          </dl>
        </div>

        <div className="lp-stage-group">
          <div className="lp-stage-group__head">
            <h3 className="lp-h3 max-w-[18ch] text-[max(1.25rem,calc(34*var(--u)))]">A person signs off before anything is published.</h3>
            <p className="lp-body mt-3 max-w-[36ch]">Publishing stays locked while:</p>
          </div>
          <ul className="lp-tiles">
            {PUBLISH_GATES.map((g) => (
              <li key={g.text} className="lp-ftile" style={tone(g.tone)}>
                <span className="lp-ftile__title first-letter:uppercase">{g.text}</span>
                <TileArt kind="gate" />
              </li>
            ))}
            <li aria-hidden="true" className="lp-ftile lp-ftile--ink">
              <span className="lp-ftile__title">Publish handover</span>
              <span className="lp-hand mt-2 text-[var(--t-lime)]">locked until all four clear</span>
              <span className="lp-ftile__art">
                <Lock className="h-full w-auto" strokeWidth={1.75} />
              </span>
            </li>
          </ul>
        </div>
      </section>

      <LivingHandover />

      {/* ── 7 · Privacy: split card + sky panel ───── */}
      <section id="privacy" aria-labelledby="privacy-title" className="lp-split">
        <div className="lp-split__card" data-reveal>
          <h2 id="privacy-title" className="lp-statement max-w-[16ch]">
            Built for group chats full of phone numbers.
          </h2>
          <p className="lp-body max-w-[52ch]">
            Student and volunteer groups run on WhatsApp. Sharing those chats for a handover shouldn&rsquo;t mean sharing everyone&rsquo;s details. You confirm the
            group was told, and anyone can ask to be left out.
          </p>
          <dl className="lp-rows mt-auto">
            {PRIVACY.map((p) => (
              <div key={p.title}>
                <dt className="lp-h3 text-[max(1.125rem,calc(28*var(--u)))]">{p.title}</dt>
                <dd className="lp-body mt-1">{p.body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <figure className="lp-split__panel flex flex-col gap-4 p-[calc(22*var(--u))] lg:p-[calc(46*var(--u))]" style={tone("var(--t-sky)")}>
          <div aria-hidden="true" className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <span className="lp-big">[PHONE_1]</span>
            <span className="lp-hand pb-2">masked before it&rsquo;s stored</span>
          </div>
          <figcaption className="text-caption text-[#18181b]/75">One message from the fictional demo · Arjun Mehta · CodeCell Leads</figcaption>
          <div className="mt-auto space-y-3">
            <div className="bi-card p-5 sm:p-6">
              <p className="bi-mono text-xs text-muted-foreground">As received</p>
              <p className="bi-mono mt-2 text-sm leading-relaxed text-muted-foreground">
                our contact at orbitstack is farah khan, partnerships manager. <s>farah.khan@example.org</s>, office line <s>99999 00010</s>
              </p>
            </div>
            <div className="bi-card p-5 shadow-raised sm:p-6">
              <p className="bi-mono text-xs text-muted-foreground">As stored, and the only version AI ever sees</p>
              <p className="bi-mono mt-2 text-sm leading-relaxed">
                our contact at orbitstack is farah khan, partnerships manager. <Token>[EMAIL_1]</Token>, office line <Token>[PHONE_1]</Token>
              </p>
            </div>
            <p className="text-caption text-[#18181b]/75">The original upload is deleted once processing succeeds.</p>
          </div>
        </figure>
      </section>

      {/* ── 8 · Works today, early access, preview ── */}
      <ComingNext />

      <ForTheNerds />

      {/* ── 9 · Outro: stair-stepped words over the pixel field ── */}
      <section data-outro aria-labelledby="cta-title" className="lp-outro">
        <PixelField />
        <h2 id="cta-title" className="lp-display lp-outro__words">
          <span className="lp-outro__row">
            <span data-outro-word style={{ "--lift": "0em" } as CSSProperties}>
              The next person
            </span>{" "}
            <span data-outro-word style={{ "--lift": "0.85em" } as CSSProperties}>
              shouldn&rsquo;t
            </span>
          </span>{" "}
          <span className="lp-outro__row">
            <span data-outro-word style={{ "--lift": "0.3em" } as CSSProperties}>
              have to start
            </span>{" "}
            <span data-outro-word style={{ "--lift": "1.1em" } as CSSProperties}>
              from scratch.
            </span>
          </span>
        </h2>
      </section>

      {/* ── 10 · Closing card ─────────────────────── */}
      <section aria-labelledby="close-title" className="lp-close">
        <div className="lp-close__card">
          <span aria-hidden="true" className="lp-close__frame">
            <span className="lp-tick" style={{ left: 0, top: 0 }} />
            <span className="lp-tick" style={{ left: "100%", top: 0 }} />
            <span className="lp-tick" style={{ left: 0, top: "100%" }} />
            <span className="lp-tick" style={{ left: "100%", top: "100%" }} />
          </span>
          <div className="relative flex flex-col items-center" data-reveal>
            <h2 id="close-title" className="lp-h2 max-w-[12ch]">
              See it working first.
            </h2>
            <p className="lp-hand mt-4">no sign-in for the demo</p>
            <p className="lp-body mt-5 max-w-[40ch]">The CodeCell demo shows the review workspace and the handover the incoming lead receives.</p>
            <LandingCtas demoLabel="Explore the CodeCell demo" className="mt-8 justify-center" />
            <p className="mt-4 text-caption text-muted-foreground">Fictional data only · Nothing is saved or sent</p>
          </div>
        </div>
      </section>
    </div>
  );
}
