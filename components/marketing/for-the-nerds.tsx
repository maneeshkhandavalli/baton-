import { ChevronDown } from "lucide-react";

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
    <section id="for-the-nerds" aria-labelledby="nerds-title" className="border-t border-border">
      <div className="bi-wrap py-20 sm:py-24">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
          <h2 id="nerds-title" className="bi-h2">
            For the nerds: how Baton keeps AI honest.
          </h2>
          <p className="bi-lede">Deterministic checks, database rules and people sit between every AI output and what the incoming person reads.</p>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          {/* The pipeline, in order */}
          <figure>
            <figcaption className="bi-mono text-xs text-muted-foreground">From upload to published handover</figcaption>
            <ol className="mt-3 border-b border-border">
              {FLOW.map((f, i) => (
                <li key={f.step} className="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-border py-3 sm:grid-cols-[2rem_8rem_1fr] [&>*]:min-w-0">
                  <span className="bi-mono text-sm text-muted-foreground tabular-nums">
                    <span className="sr-only">Step </span>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="bi-h3 block text-[0.9375rem]">{f.step}</span>
                    <span className={cn("bi-mono text-xs", f.where === "people" ? "text-foreground" : "text-muted-foreground")}>{f.where}</span>
                  </span>
                  <p className="bi-body col-start-2 text-sm sm:col-start-3">{f.body}</p>
                </li>
              ))}
            </ol>
          </figure>

          {/* The details, collapsed by default */}
          <div className="border-b border-border">
            {TOPICS.map((t) => (
              <details key={t.title} className="group border-t border-border">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="bi-h3 block text-[0.9375rem]">{t.title}</span>
                    <span className="bi-body block text-sm">{t.summary}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <ul className="space-y-2 pb-4">
                  {t.points.map((p) => (
                    <li key={p} className="bi-body text-sm">
                      {p}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </div>

        <p className="bi-mono mt-12 text-xs text-muted-foreground">Built with {STACK.join(" · ")}</p>
      </div>
    </section>
  );
}
