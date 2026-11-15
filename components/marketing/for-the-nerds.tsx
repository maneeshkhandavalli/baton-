import { Database, KeyRound, Layers, Lock, ScanSearch, ShieldCheck, Sparkles, UserCheck, Users } from "lucide-react";

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
    <section id="for-the-nerds" aria-labelledby="nerds-title" className="border-t border-border">
      <div className="bi-wrap py-20 sm:py-24">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
          <h2 id="nerds-title" className="bi-h2">
            For the nerds: how Baton keeps AI honest.
          </h2>
          <p className="bi-lede">
            The model drafts; it never decides. Deterministic checks, database rules and people sit between every AI output and what the incoming person
            reads.
          </p>
        </div>

        {/* The pipeline, in order, as a manifest */}
        <figure className="mt-12">
          <figcaption className="sr-only">From upload to published handover, in order</figcaption>
          <ol className="border-b border-border">
            {FLOW.map((f, i) => (
              <li key={f.step} className="grid gap-1 border-t border-border py-4 sm:grid-cols-[3rem_10rem_1fr_9rem] sm:items-baseline sm:gap-6 [&>*]:min-w-0">
                <span className="bi-mono text-sm text-muted-foreground tabular-nums">
                  <span className="sr-only">Step </span>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="bi-h3">{f.step}</h3>
                <p className="bi-body">{f.body}</p>
                <span className={cn("bi-mono text-sm sm:text-right", f.where === "people" ? "text-foreground" : "text-muted-foreground")}>{f.where}</span>
              </li>
            ))}
          </ol>
        </figure>

        <div className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {DETAILS.map((d) => (
            <article key={d.title}>
              <h3 className="bi-h3">{d.title}</h3>
              <ul className="mt-3 space-y-2">
                {d.points.map((p) => (
                  <li key={p} className="bi-body text-sm">
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="bi-mono mt-14 border-t border-border pt-5 text-xs text-muted-foreground">Built with {STACK.join(" · ")}</p>
      </div>
    </section>
  );
}
