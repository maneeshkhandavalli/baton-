import { ArrowDown, ArrowRight, Database, KeyRound, Layers, Lock, ScanSearch, ShieldCheck, Sparkles, UserCheck, Users } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "For the nerds": how Baton is built, for technical readers. Every statement here mirrors the code:
 *   pipeline stages      lib/pipeline/stages (parse → extract → verify-quotes → verify-support → prepare-review)
 *   quote check          lib/ai/quote-check.ts (normalised tier, grapheme boundaries, ≥ 12 chars and 3 words)
 *   support check        lib/pipeline/stages/verify-support.ts (claim + quote + ≤ 3 neighbours, never the rationale)
 *   database security    supabase/migrations/*_access_control.sql and *_grants.sql
 *   roles and clearance  lib/contracts/enums.ts (MEMBER_ROLES, ACCESS_LEVELS)
 *   privacy              lib/privacy (masking, HMAC identity hashes with a server-side pepper), raw-file deletion
 *   AI provider          components/wizard/consent.tsx (Gemini Developer API, free tier, disclosed before upload)
 * Keep them in step when any of those change.
 */

const FLOW = [
  { icon: Layers, step: "Parse", where: "server", body: "WhatsApp exports and documents become messages with authors, times and stable IDs." },
  { icon: ShieldCheck, step: "Mask", where: "server", body: "Phone numbers, emails, UPI handles, bank details, IDs and secrets are replaced before storage or AI." },
  { icon: Sparkles, step: "Extract", where: "Gemini", body: "Structured JSON against a schema, validated with Zod. Claims cite message quotes; a claim without one is marked inferred." },
  { icon: ScanSearch, step: "Quote check", where: "deterministic", body: "Each quote must exist in the cited message. No AI involved, so it can't be talked round." },
  { icon: Sparkles, step: "Support check", where: "second model", body: "A separate call judges whether the quote actually backs the claim." },
  { icon: UserCheck, step: "Human review", where: "people", body: "Approve, edit or reject each point, settle conflicts, answer the gaps. Then publish." },
] as const;

const DETAILS = [
  {
    icon: Database,
    title: "Postgres does the enforcing",
    points: [
      "Row-level security is authoritative for every read.",
      "Browser roles have no direct write grants: every write is a SECURITY DEFINER function that checks role, clearance and lifecycle state.",
      "Default privileges are revoked, then granted back table by table and column by column.",
    ],
  },
  {
    icon: Users,
    title: "Roles and clearance",
    points: [
      "Members are outgoing, incoming, lead or reviewer. The creator is an authority, not a role.",
      "Sources carry an access level: everyone, leads only or reviewer only.",
      "A point inherits the strictest level of the sources behind it, and members only see what their clearance allows.",
    ],
  },
  {
    icon: ScanSearch,
    title: "Evidence you can check",
    points: [
      "Quotes match exactly or after normalisation (Unicode format characters, NFC, curly quotes and dashes, whitespace), and only on whole characters.",
      "Quotes shorter than 12 characters or 3 words don't count, so a point can't be propped up by \"ok sure\".",
      "The support check sees the claim, the quote and up to three neighbouring messages, never the extractor's reasoning.",
    ],
  },
  {
    icon: Lock,
    title: "Chats are data, never instructions",
    points: [
      "Messages that read like instructions to the model can't raise a point's status: the verdict is downgraded and a person decides.",
      "Statuses (sourced, inferred, conflicting, missing) are computed from the evidence, not chosen by the model.",
      "Pipeline jobs are fenced by a claim generation, so a slow or retried worker can never overwrite newer results.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Privacy by construction",
    points: [
      "Masking happens before anything is stored or sent to AI. Raw uploads are deleted once processing succeeds.",
      "People who ask to be left out are matched by HMAC-SHA256 identity hashes with a server-side pepper, never by stored numbers.",
      "AI runs on the Gemini Developer API free tier. The upload step says so plainly, including what that means for your content.",
    ],
  },
  {
    icon: KeyRound,
    title: "Sessions and secrets",
    points: [
      "Supabase Auth with Google (OAuth, PKCE) or email and password, both linked to one account per verified address.",
      "Sessions live in httpOnly cookies. Every server action re-verifies the user with Supabase before acting.",
      "The service key and AI key exist only on the server. The browser holds nothing but the public key.",
    ],
  },
] as const;

const STACK = ["Next.js 16 · App Router", "Supabase Postgres, Auth, Storage", "Vercel Fluid compute", "Gemini 3.x Flash", "Zod schemas", "TypeScript"] as const;

export function ForTheNerds() {
  return (
    <section id="for-the-nerds" aria-labelledby="nerds-title" className="border-b border-border/70 bg-card/50">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-12">
          <div className="reveal space-y-3">
            <p className="type-eyebrow text-muted-foreground">
              <span aria-hidden="true" className="font-mono text-primary-fg">
                {"</>"}{" "}
              </span>
              For the nerds
            </p>
            <h2 id="nerds-title" className="type-section-title sm:text-4xl">
              How Baton keeps AI honest.
            </h2>
          </div>
          <div className="reveal space-y-3">
            <p className="type-body text-muted-foreground">
              The model drafts; it never decides. Deterministic checks, database rules and people sit between every AI output and what the incoming person reads.
            </p>
            <ul aria-label="Built with" className="flex flex-wrap gap-1.5">
              {STACK.map((s) => (
                <li key={s} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[0.7rem] leading-none text-foreground/80">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Architecture flow: a list, drawn as a pipeline. */}
        <figure className="mt-12 lg:mt-14">
          <figcaption className="sr-only">From upload to published handover, in order</figcaption>
          <ol className="reveal-group grid gap-2 md:grid-cols-3 md:gap-3 xl:grid-cols-6">
            {FLOW.map((f, i) => (
              <li key={f.step} className="group relative">
                <div
                  className={cn(
                    "flex h-full flex-col rounded-xl border bg-background p-4 transition-[transform,border-color] duration-300 hover:-translate-y-0.5",
                    f.where === "people" ? "border-primary/40" : "border-border hover:border-foreground/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <f.icon aria-hidden="true" className={cn("size-4", f.where === "people" ? "text-primary" : "text-muted-foreground")} />
                    <span className="font-mono text-[0.7rem] text-muted-foreground">
                      <span className="sr-only">Step </span>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground">{f.where}</span>
                  </div>
                  <h3 className="mt-3 font-semibold">{f.step}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
                {i < FLOW.length - 1 ? (
                  <>
                    <ArrowDown aria-hidden="true" className="mx-auto my-0.5 size-4 text-muted-foreground/60 md:hidden" />
                    <ArrowRight
                      aria-hidden="true"
                      className={cn(
                        "absolute top-1/2 -right-3 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-card/80 text-muted-foreground/70",
                        i % 3 === 2 ? "xl:block" : "md:block",
                      )}
                    />
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </figure>

        <div className="reveal-group mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DETAILS.map((d) => (
            <article key={d.title} className="rounded-2xl border border-border bg-background p-5 transition-shadow duration-300 hover:shadow-raised sm:p-6">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary-fg">
                  <d.icon aria-hidden="true" className="size-4" />
                </span>
                <h3 className="type-heading">{d.title}</h3>
              </div>
              <ul className="mt-4 space-y-2.5">
                {d.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
