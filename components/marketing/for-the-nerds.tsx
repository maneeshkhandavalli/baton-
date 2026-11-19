import { Plus } from "lucide-react";

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
  { step: "Parse", where: "server", body: "Exports and documents become messages with authors, times and stable IDs." },
  { step: "Mask", where: "server", body: "Personal and financial details are replaced before anything is stored or sent to AI." },
  { step: "Extract", where: "Gemini", body: "Schema-validated JSON; every claim cites message quotes or is marked inferred." },
  { step: "Quote check", where: "deterministic", body: "Each quote must exist in the cited message. No AI involved." },
  { step: "Support check", where: "second model", body: "A separate call judges whether the quote backs the claim." },
  { step: "Human review", where: "people", body: "Approve, edit or reject each point, settle conflicts, answer gaps, then publish." },
] as const;

/** One row per topic, a one-line summary visible, the detail on demand. No repetition of the flow above. */
const TOPICS = [
  {
    title: "PII masking and privacy",
    summary: "Masked before storage or AI; raw uploads deleted after processing.",
    points: [
      "Phone numbers, emails, UPI handles, bank and card details, IDs, passwords and keys become tokens like [PHONE_1]. The same value always gets the same token.",
      "People who ask to be left out are matched by HMAC-SHA256 identity hashes with a server-side pepper, never by stored numbers.",
      "AI runs on the Gemini Developer API free tier, and the upload step says so before anything is sent.",
    ],
  },
  {
    title: "Evidence and source traceability",
    summary: "Every point links to the exact message and line it came from.",
    points: [
      "Quotes match exactly or after normalisation (Unicode, curly quotes, dashes, whitespace), on whole characters only.",
      "Quotes under 12 characters or 3 words don't count, so “ok sure” can't prop up a point.",
      "Sourced, inferred, conflicting and missing are computed from the evidence, not chosen by the model.",
    ],
  },
  {
    title: "AI extraction and verification",
    summary: "The model drafts; it never decides.",
    points: [
      "The support check sees the claim, the quote and up to three neighbouring messages, never the extractor's reasoning.",
      "Messages that read like instructions to a model can't raise a point's status; the verdict is downgraded and a person decides.",
    ],
  },
  {
    title: "Human review",
    summary: "Nothing is published until a person has signed off.",
    points: [
      "Publishing stays locked while any point is pending, an inferred point is unconfirmed, a conflict is open or a required gap is unanswered.",
      "Edits create a new revision; the original text and its evidence are kept.",
    ],
  },
  {
    title: "Publishing and access controls",
    summary: "Postgres row-level security decides who sees what.",
    points: [
      "Roles are outgoing, incoming, lead and reviewer; each source is visible to everyone, leads only or reviewers only, and a point takes the strictest level of its evidence.",
      "Browsers have no direct write access: every write is a database function that checks role, clearance and lifecycle state.",
      "Sessions live in httpOnly cookies, and service and AI keys exist only on the server.",
    ],
  },
] as const;

const STACK = ["Next.js 16", "Supabase Postgres, Auth, Storage", "Vercel", "Gemini 3.x Flash", "Zod", "TypeScript"] as const;

export function ForTheNerds() {
  return (
    <section id="for-the-nerds" aria-labelledby="nerds-title" className="bi-band">
      <div className="bi-wrap py-20 sm:py-28">
        <div className="reveal grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <div>
            <p className="bi-tag">For the nerds</p>
            <h2 id="nerds-title" className="bi-h2 mt-4">
              How Baton keeps <span className="text-[var(--highlight)]">AI honest</span>.
            </h2>
          </div>
          <p className="bi-lede">Deterministic checks, database rules and people sit between every AI output and what the incoming person reads.</p>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          {/* The pipeline, in order */}
          <figure className="min-w-0">
            <figcaption className="bi-mono text-xs text-muted-foreground">From upload to published handover</figcaption>
            <ol className="reveal-group relative mt-5 space-y-1.5 before:absolute before:top-5 before:bottom-5 before:left-[1.1875rem] before:w-px before:bg-[var(--border-strong)]">
              {FLOW.map((f, i) => (
                <li key={f.step} className="relative grid grid-cols-[2.5rem_1fr] gap-x-4 [&>*]:min-w-0">
                  <span
                    className={cn(
                      "bi-mono relative grid size-10 place-items-center rounded-full border text-sm tabular-nums",
                      f.where === "people" ? "border-transparent bg-[var(--highlight)] text-[var(--on-highlight)]" : "border-[var(--border-strong)] bg-[var(--inverse)] text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">Step </span>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="pt-1.5 pb-3">
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="bi-h3 text-[1.0625rem]">{f.step}</span>
                      <span className={cn("bi-mono rounded-full border px-2 py-px text-[0.6875rem]", f.where === "people" ? "border-[var(--highlight)] text-[var(--highlight)]" : "border-border text-muted-foreground")}>
                        {f.where}
                      </span>
                    </p>
                    <p className="bi-body mt-1 text-sm">{f.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </figure>

          {/* The details, collapsed by default */}
          <div className="min-w-0">
            <p className="bi-mono text-xs text-muted-foreground">The details, if you want them</p>
            <div className="mt-5 border-b border-border">
              {TOPICS.map((t) => (
                <details key={t.title} className="bi-details group border-t border-border">
                  <summary className="flex cursor-pointer items-start justify-between gap-4 rounded-sm py-4">
                    <span className="min-w-0">
                      <span className="bi-h3 block text-[1.0625rem]">{t.title}</span>
                      <span className="bi-body mt-0.5 block text-sm">{t.summary}</span>
                    </span>
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border-strong text-muted-foreground transition-colors group-hover:text-foreground">
                      <Plus aria-hidden="true" className="bi-details__icon size-3.5" />
                    </span>
                  </summary>
                  <ul className="space-y-2.5 pb-5">
                    {t.points.map((p) => (
                      <li key={p} className="bi-body flex gap-3 text-sm">
                        <span aria-hidden="true" className="bi-mono text-[var(--highlight)]">
                          →
                        </span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>
        </div>

        <ul aria-label="Built with" className="mt-14 flex flex-wrap gap-2">
          {STACK.map((s) => (
            <li key={s} className="bi-tag">
              {s}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
