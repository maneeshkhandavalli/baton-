import { ArrowRight, GitCompareArrows, Lock, RefreshCw } from "lucide-react";

import { PreviewLabel } from "@/components/marketing/preview-label";

/**
 * Living Handovers: keeping a handover true after the person has left.
 *
 * Two halves, labelled differently on purpose:
 *  - WORKS TODAY: source versions and change review (R3 Task 05B/05E: components/settings/source-version-upload.tsx,
 *    app/(workspace)/handover/[id]/changes). A newer export or document is compared with the previous version; each
 *    change waits for a reviewer, publishing waits until all are decided, and published snapshots are never touched.
 *    The change labels are the product's own (lib/contracts/change-review.ts changeReviewKindText).
 *  - PREVIEW: watching a connected chat after publishing. It does not exist yet, so it carries the Preview label and
 *    nothing in it is interactive.
 * Content is the fictional CodeCell scenario used by the demo.
 */

const VERSIONS = [
  { v: "v1", note: "published 12 Nov" },
  { v: "v2", note: "uploaded 3 Dec" },
] as const;

const CHANGES = [
  { kind: "New information", point: "Workshop fee: ₹100 for non-members again from January", note: "From messages added after the previous version" },
  { kind: "Possible contradiction", point: "Workshops are free for everyone", note: "A newer message disagrees with this point" },
  { kind: "Quotation moved", point: "GitHub organisation owners", note: "Now in another message; the wording still matches" },
] as const;

function ChangesFragment() {
  return (
    <figure aria-label="Example: the source changes Baton found in a newer chat export" className="bi-card overflow-hidden text-sm shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 font-semibold">
          <GitCompareArrows aria-hidden="true" className="size-4 text-muted-foreground" />
          Source changes
        </p>
        <p className="bi-mono flex items-center gap-1.5 text-xs text-muted-foreground">
          {VERSIONS.map((x, i) => (
            <span key={x.v} className="inline-flex items-center gap-1.5">
              {i > 0 ? <ArrowRight aria-hidden="true" className="size-3" /> : null}
              <span className="rounded-full border border-border-strong px-1.5 text-foreground">{x.v}</span>
              <span className="hidden sm:inline">{x.note}</span>
            </span>
          ))}
        </p>
      </div>
      <p className="bi-mono border-b border-border px-4 py-2 text-xs text-muted-foreground">WhatsApp Chat with CodeCell Core Team 26-27</p>
      <ul className="divide-y divide-border">
        {CHANGES.map((c) => (
          <li key={c.kind} className="grid gap-1 px-4 py-3 sm:grid-cols-[10.5rem_1fr] sm:gap-4">
            <span className="bi-mono text-xs text-[var(--highlight-ink)]">{c.kind}</span>
            <span className="min-w-0">
              <span className="block font-medium">{c.point}</span>
              <span className="block text-caption text-muted-foreground">{c.note}</span>
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                Waiting for a reviewer
              </span>
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="flex items-center gap-2 border-t border-border bg-muted/60 px-4 py-2.5 text-caption text-muted-foreground">
        <Lock aria-hidden="true" className="size-3.5" />3 changes to decide. Publishing v2 waits until each one is decided.
      </figcaption>
    </figure>
  );
}

/** New messages after publishing are matched against the handover and flagged for a person to review. */
function WatchingFragment() {
  const rows = [
    { tag: "Outdated", tone: "text-warning-fg", text: "Workshops are free for everyone", note: "Kabir, 3 Dec: “₹100 for non-members again from Jan”" },
    { tag: "Owner changed", tone: "text-foreground", text: "Venue bookings: Rohan → Ananya", note: "Rohan, 28 Nov: “ananya takes over bookings”" },
    { tag: "Done", tone: "text-success-fg", text: "Renew the codecell.dev domain", note: "Neha, 25 Nov: “renewed till 2027”" },
    { tag: "Needs review", tone: "text-muted-foreground", text: "New sponsor contact at Orbitstack", note: "Mentioned once; not yet in the handover" },
  ] as const;
  return (
    <figure aria-label="Living Handover: illustrative preview" className="bi-card overflow-hidden border-dashed text-sm">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.text} className="grid gap-0.5 px-4 py-3 sm:grid-cols-[7rem_1fr] sm:gap-3">
            <span className={`bi-mono text-xs ${r.tone}`}>{r.tag}</span>
            <span className="min-w-0">
              <span className="font-medium">{r.text}</span>
              <span className="block truncate text-caption text-muted-foreground">{r.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function LivingHandover() {
  return (
    <section id="living-handovers" aria-labelledby="living-title" className="py-16 sm:py-24">
      <div className="bi-wrap">
        <div className="reveal grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <div>
            <p className="bi-tag">Living Handovers</p>
            <h2 id="living-title" className="bi-h2 mt-4">
              A handover that keeps up with the <span className="bi-swipe">team</span>.
            </h2>
          </div>
          <p className="bi-lede">
            Projects keep moving after someone leaves. Baton keeps the handover honest as its sources change, and never edits it behind anyone&rsquo;s back.
          </p>
        </div>

        <div className="reveal-group mt-12 grid gap-5 lg:grid-cols-[1.15fr_1fr] lg:gap-6">
          <article aria-labelledby="living-today" className="bi-stage flex flex-col gap-6 p-5 sm:p-8">
            <div>
              <span className="bi-tag" data-tone="live">
                Works today
              </span>
              <h3 id="living-today" className="bi-h3 mt-4 text-[1.375rem]">
                Upload a newer version of a source
              </h3>
              <p className="bi-body mt-2 max-w-[54ch]">
                Add the latest export of a chat or a revised document. Baton compares it with the version before and lists what changed. Every change waits
                for a reviewer&rsquo;s decision, publishing waits until each one is decided, and earlier published versions stay exactly as they were.
              </p>
            </div>
            <ChangesFragment />
            <p aria-hidden="true" className="bi-hand -mt-2 self-end rotate-[-3deg] pr-2">
              nothing changes on its own ↑
            </p>
          </article>

          <article aria-labelledby="living-next" className="bi-card flex flex-col gap-6 border-dashed border-border-strong bg-transparent p-5 sm:p-8">
            <div>
              <PreviewLabel />
              <h3 id="living-next" className="bi-h3 mt-4 flex items-center gap-2 text-[1.375rem]">
                <RefreshCw aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                Living Handover
              </h3>
              <p className="bi-body mt-2">
                Next, the handover watches the chat for you. After publishing, new messages are checked against it. Outdated decisions, changed owners and
                finished tasks are flagged for a person to confirm.
              </p>
            </div>
            <WatchingFragment />
            <p className="text-caption text-muted-foreground">An illustration with invented CodeCell content, not a feature you can use today.</p>
          </article>
        </div>
      </div>
    </section>
  );
}
