import { ArrowRight, GitCompareArrows, Lock } from "lucide-react";
import type { CSSProperties } from "react";

import { EarlyAccessLabel } from "@/components/marketing/early-access-label";

/**
 * Living Handovers: keeping a handover true after the person has left (reference: the split "folders" panel, a white
 * card beside a colour panel of stacked folder tabs).
 *
 * Labelled differently on purpose:
 *  - WORKS TODAY: source versions and change review (R3 Task 05B/05E: components/settings/source-version-upload.tsx,
 *    app/(workspace)/handover/[id]/changes). A newer export or document is compared with the previous version; each
 *    change waits for a reviewer, publishing waits until all are decided, and published snapshots are never touched.
 *    The change labels are the product's own (lib/contracts/change-review.ts changeReviewKindText).
 *  - EARLY ACCESS: watching a connected channel after publishing. It depends on the GitHub, Discord, Telegram and
 *    Slack connectors, which are built but not yet set up with real apps, so it is labelled Early access and nothing
 *    here suggests a live sync.
 * Content is the fictional CodeCell scenario used by the demo. Decorative tabs are aria-hidden.
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

const TABS = [
  { label: "v2 · 3 Dec", c: "var(--t-lime)", x: "62%" },
  { label: "v1 · 12 Nov", c: "var(--t-sky)", x: "4%" },
  { label: "Core Team", c: "var(--t-apricot)", x: "36%" },
  { label: "Leads", c: "var(--t-mauve)", x: "66%" },
  { label: "infra-notes", c: "var(--t-stone)", x: "8%" },
  { label: "handbook", c: "var(--t-lime-3)", x: "40%" },
  { label: "MoU", c: "var(--t-sky)", x: "70%" },
] as const;

function ChangesFragment() {
  return (
    <figure aria-label="Example: the source changes Baton found in a newer chat export" className="bi-card overflow-hidden text-sm">
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

export function LivingHandover() {
  return (
    <section id="living-handovers" aria-labelledby="living-title" className="lp-split">
      <div className="lp-split__card" data-reveal>
        <span className="bi-tag" data-tone="live">
          Works today
        </span>
        <h2 id="living-title" className="lp-statement max-w-[16ch]">
          A handover that keeps up with the team.
        </h2>
        <p className="lp-body max-w-[48ch]">
          Projects keep moving after someone leaves. Baton keeps the handover honest as its sources change, and never edits it behind anyone&rsquo;s back.
        </p>
        <div className="mt-auto space-y-6">
          <div>
            <h3 className="lp-h3 text-[max(1.125rem,calc(30*var(--u)))]">Upload a newer version of a source</h3>
            <p className="lp-body mt-2 max-w-[54ch]">
              Add the latest export of a chat or a revised document. Baton compares it with the version before and lists what changed. Every change waits
              for a reviewer&rsquo;s decision, publishing waits until each one is decided, and earlier published versions stay exactly as they were.
            </p>
          </div>
          <div className="border-t border-border pt-5">
            <EarlyAccessLabel />
            <p className="lp-body mt-3 max-w-[54ch]">
              Watching a connected channel: after publishing, new messages from a connected GitHub, Discord, Telegram or Slack would be checked against the
              handover, and outdated decisions, changed owners and finished tasks flagged for a person to confirm. The connectors are built but not yet set
              up with real apps, so nothing syncs today.
            </p>
          </div>
        </div>
      </div>

      <div className="lp-split__panel" style={{ "--c": "var(--t-stone)" } as CSSProperties}>
        <div aria-hidden="true" className="lp-folders" data-folders>
          {TABS.map((t, i) => (
            <div key={t.label} data-folder className="lp-folder" style={{ "--c": t.c, "--x": t.x, zIndex: i } as CSSProperties}>
              <span className="lp-folder__tab">{t.label}</span>
            </div>
          ))}
        </div>
        <div className="lp-split__float">
          <ChangesFragment />
          <p aria-hidden="true" className="lp-hand mt-4 justify-self-end rotate-[-3deg]">
            nothing changes on its own ↑
          </p>
        </div>
      </div>
    </section>
  );
}
