import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  Eye,
  FileLock2,
  FileText,
  ListChecks,
  ScanSearch,
  ShieldCheck,
  Upload,
  UserCheck,
} from "lucide-react";

import { ProductPreview } from "@/components/marketing/product-preview";
import { FadeIn } from "@/components/shared/fade-in";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { statusConfig } from "@/config/status";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { EVIDENCE_STATUSES } from "@/types/status";

/** Three facts the product enforces, shown under the hero actions. */
const PROMISES = [
  { icon: ShieldCheck, text: "Personal details masked before AI sees them" },
  { icon: BadgeCheck, text: "Every point quotes its source, word for word" },
  { icon: UserCheck, text: "Nothing is published until a person reviews it" },
] as const;

/** What the extractor looks for (lib/contracts/enums.ts POINT_CATEGORIES, plus due dates on tasks). */
const EXTRACTS = ["Decisions", "Owners", "Open tasks", "Deadlines", "Blockers", "Risks", "Contacts", "Account access"] as const;

const STEPS = [
  {
    icon: Upload,
    title: "Bring the real record",
    body: "Export the team's WhatsApp groups and add handbooks, MoUs and notes. Choose the dates and conversations that matter, and who may see each source.",
    detail: "WhatsApp .txt or .zip · PDF · Word · Markdown · text",
  },
  {
    icon: ScanSearch,
    title: "Baton drafts, with receipts",
    body: "Personal details are masked first. AI then drafts the handover, and every quote it cites is matched against the original text and checked separately to confirm it backs the point.",
    detail: null,
  },
  {
    icon: ListChecks,
    title: "People review every claim",
    body: "The outgoing member and reviewers approve, edit or reject each point and settle disagreements. Whatever no source covers goes to a short Gap Interview.",
    detail: null,
  },
  {
    icon: BookOpen,
    title: "Hand over with confidence",
    body: "The incoming person gets a clear handover and a first-week checklist, and acknowledges that they have read it.",
    detail: null,
  },
] as const;

const STATUS_DETAIL = {
  sourced: "A quote that exists word for word in the source, checked separately to make sure it actually backs the claim.",
  inferred: "A reasonable reading with no quote that states it outright. A reviewer must confirm it before it's published.",
  conflicting: "Sources disagree. Both sides stay visible, newest first, until a person records what's true now.",
  missing: "Something a handover should cover that nobody wrote down. It becomes a Gap Interview question.",
} as const;

const STATUS_ACCENT = {
  sourced: "border-t-status-sourced",
  inferred: "border-t-status-inferred",
  conflicting: "border-t-status-conflicting",
  missing: "border-t-status-missing",
} as const;

/** Mirrors the publish readiness check (lib/contracts/dto.ts READINESS_BLOCKERS). */
const PUBLISH_GATES = [
  "a point is still waiting for review",
  "an inferred point is unconfirmed",
  "a conflict is unresolved",
  "a required gap question is unanswered",
] as const;

const PRIVACY = [
  { icon: ShieldCheck, title: "Masked first", body: "Phone numbers, emails, UPI handles, bank details, IDs and passwords are masked before anything is stored or sent to AI." },
  { icon: FileLock2, title: "Raw files deleted", body: "Your uploads are deleted as soon as processing succeeds. Only masked, permitted evidence is kept." },
  { icon: Eye, title: "Access by source", body: "Mark a chat as leads-only or reviewer-only, and every point drawn from it inherits that restriction." },
] as const;

export default function HomePage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section aria-labelledby="hero-title" className="overflow-x-clip">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:pt-24">
          <FadeIn className="space-y-6">
            <p className="type-eyebrow text-primary-fg">{siteConfig.tagline}</p>
            <h1 id="hero-title" className="type-display">
              Hand over a project <em className="text-primary">without losing what matters.</em>
            </h1>
            <p className="max-w-xl type-body-lg text-muted-foreground">
              When someone leaves a club role or project team, what they know usually leaves with them. Baton turns the team&rsquo;s WhatsApp exports and documents
              into a handover for the next person, where every decision, owner, task and risk links back to the exact message it came from.
            </p>
            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
              <Link href={routes.handover.new} className={buttonVariants({ size: "xl" })}>
                Start a handover
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
              <Link href={routes.demo} className={buttonVariants({ size: "xl", variant: "outline" })}>
                Try the demo
              </Link>
            </div>
            <p className="text-caption text-muted-foreground">The demo is a fictional college coding club. No sign-in needed.</p>
            <ul className="grid gap-2.5 border-t border-border pt-6 sm:grid-cols-3 sm:gap-4 lg:grid-cols-1 xl:grid-cols-3">
              {PROMISES.map((p) => (
                <li key={p.text} className="flex items-start gap-2.5 text-sm leading-snug">
                  <p.icon aria-hidden="true" className="mt-px size-4 shrink-0 text-primary" />
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
          </FadeIn>
          <FadeIn delay={0.15} className="mx-auto w-full max-w-xl lg:max-w-none">
            <ProductPreview />
          </FadeIn>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────── */}
      <section id="how-it-works" aria-labelledby="how-title" className="border-y border-border/70 bg-card/50">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-12">
            <div className="space-y-3">
              <p className="type-eyebrow text-muted-foreground">How it works</p>
              <h2 id="how-title" className="type-section-title sm:text-4xl">
                From group chat to handover in an afternoon.
              </h2>
            </div>
            <div className="space-y-3">
              <p className="type-body text-muted-foreground">Baton reads the record your team already has and pulls out what the next person needs:</p>
              <ul aria-label="What Baton extracts" className="flex flex-wrap gap-1.5">
                {EXTRACTS.map((e) => (
                  <li key={e} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground/85">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:mt-14 xl:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-fg">
                    <step.icon aria-hidden="true" className="size-4.5" />
                  </span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    <span className="sr-only">Step </span>0{i + 1}
                  </span>
                </div>
                <h3 className="mt-5 type-heading">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                {step.detail && (
                  <p className="mt-auto flex items-start gap-1.5 pt-4 text-caption text-muted-foreground">
                    <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    {step.detail}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Evidence ─────────────────────────────────────── */}
      <section id="evidence" aria-labelledby="evidence-title" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl space-y-3">
          <p className="type-eyebrow text-muted-foreground">Evidence</p>
          <h2 id="evidence-title" className="type-section-title sm:text-4xl">
            Every point shows how sure you can be.
          </h2>
          <p className="type-body text-muted-foreground">
            Baton never presents a guess as a fact. Each point carries one of four labels, worked out from the evidence rather than set by hand.
          </p>
        </div>
        <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EVIDENCE_STATUSES.map((s) => (
            <div key={s} className={cn("space-y-3 rounded-2xl border border-t-2 border-border bg-card p-5", STATUS_ACCENT[s])}>
              <dt>
                <StatusBadge status={s} />
              </dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">
                {STATUS_DETAIL[s]}
                <span className="sr-only"> {statusConfig[s].description}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-5 sm:flex-row sm:items-start sm:gap-4 sm:p-6">
          <UserCheck aria-hidden="true" className="size-5 shrink-0 text-primary" />
          <div className="space-y-1.5">
            <h3 className="type-heading">A person signs off before anything is published</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Baton won&rsquo;t publish a handover while {PUBLISH_GATES.slice(0, -1).join(", ")}, or {PUBLISH_GATES[PUBLISH_GATES.length - 1]}.
            </p>
          </div>
        </div>
      </section>

      {/* ── Privacy ──────────────────────────────────────── */}
      <section id="privacy" aria-labelledby="privacy-title" className="bg-inverse text-inverse-foreground">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            <p className="type-eyebrow text-inverse-muted">Privacy</p>
            <h2 id="privacy-title" className="type-section-title sm:text-4xl">
              Built for group chats full of phone numbers.
            </h2>
            <p className="type-body text-inverse-muted">
              Student and volunteer groups run on WhatsApp. Baton is designed so that sharing those chats for a handover doesn&rsquo;t mean sharing everyone&rsquo;s
              details. You confirm the group was told, and anyone can ask to be left out.
            </p>
          </div>
          <ul className="grid gap-8 sm:grid-cols-3 sm:gap-6 lg:grid-cols-1 xl:grid-cols-3">
            {PRIVACY.map((p) => (
              <li key={p.title} className="space-y-2 border-t border-inverse-muted/30 pt-5">
                <p.icon aria-hidden="true" className="size-5 text-inverse-muted" />
                <h3 className="font-semibold">{p.title}</h3>
                <p className="text-sm leading-relaxed text-inverse-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Closing call to action ───────────────────────── */}
      <section aria-labelledby="cta-title" className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
        <h2 id="cta-title" className="mx-auto max-w-2xl type-page-title">
          The next person shouldn&rsquo;t have to start from scratch.
        </h2>
        <p className="mx-auto mt-4 max-w-xl type-body text-muted-foreground">
          See it working first: the CodeCell demo shows the review workspace and the handover the incoming lead receives.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          <Link href={routes.handover.new} className={buttonVariants({ size: "xl" })}>
            Start a handover
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
          <Link href={routes.demo} className={buttonVariants({ size: "xl", variant: "outline" })}>
            Explore the CodeCell demo
          </Link>
        </div>
        <ul className="mx-auto mt-8 flex max-w-xl flex-wrap justify-center gap-x-5 gap-y-2 text-caption text-muted-foreground">
          {["No sign-in for the demo", "Fictional data only", "Read-only"].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5">
              <Check aria-hidden="true" className="size-3.5 text-status-sourced" />
              {t}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
