import { ArrowRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { EarlyAccessLabel } from "@/components/marketing/early-access-label";
import { PreviewLabel } from "@/components/marketing/preview-label";

/**
 * What works today, and what comes next (reference: the roadmap wheel: cards with a big numeral band ride a
 * tick-marked wheel that turns with the scroll). Three honest stages:
 *  01 WORKS TODAY  handovers from WhatsApp exports and documents, evidence, review, and Living Handover version review
 *  02 EARLY ACCESS the GitHub, Discord, Telegram and Slack connectors and the bot-driven parts of Living Handovers;
 *                  built in code but NOT yet set up with real apps or verified live, so nothing here claims a sync
 *  03 PREVIEW      Ask the Handover; it does not exist yet
 * Without JavaScript or with reduced motion the three cards are a plain row (stack on phones); the wheel is an
 * enhancement added by components/marketing/landing-motion.tsx. Nothing here is interactive.
 */

interface Stage {
  n: string;
  word: string;
  tone: string;
  label: ReactNode;
  title: string;
  items: string[];
}

const STAGES: Stage[] = [
  {
    n: "01",
    word: "Today",
    tone: "var(--t-lime)",
    label: (
      <span className="bi-tag" data-tone="live">
        Works today
      </span>
    ),
    title: "Handovers from what you upload",
    items: [
      "WhatsApp exports and documents become a source-backed handover.",
      "Every quote checked word for word, then checked again.",
      "Review, the Gap Interview and sign-off before publishing.",
      "Living Handovers: upload a newer version, review each change.",
    ],
  },
  {
    n: "02",
    word: "Next",
    tone: "var(--t-sky)",
    label: <EarlyAccessLabel />,
    title: "Connectors for GitHub, Discord, Telegram and Slack",
    items: [
      "Built in code, not yet set up with real apps or verified live.",
      "Once set up: type /handover in the group where the work happens.",
      "Once set up: Living Handovers that watch a connected channel and flag changes for a person.",
    ],
  },
  {
    n: "03",
    word: "Later",
    tone: "var(--t-mauve)",
    label: <PreviewLabel />,
    title: "Ask the Handover",
    items: [
      "Not built yet. Nothing here works today.",
      "The idea: the incoming person asks in plain words.",
      "Answers would come only from the handover and its sources, each with references.",
      "It would say so when nothing covers the question.",
    ],
  },
];

export function ComingNext() {
  return (
    <section id="coming-next" aria-labelledby="coming-next-title" className="lp-roadmap" data-roadmap>
      <div className="lp-roadmap__pin">
        <div className="lp-roadmap__head" data-reveal>
          <h2 id="coming-next-title" className="lp-h2 mx-auto max-w-[16ch]">
            Where handovers go next.
          </h2>
          <p className="lp-body mx-auto mt-4 max-w-[52ch]">
            Each stage carries its label. Early access is built but not yet connected to live apps. Preview means not built yet: an idea, not
            features you can use today.
          </p>
        </div>

        <div className="lp-wheel" data-wheel>
          <div aria-hidden="true" className="lp-wheel__ring" />
          <ol className="lp-wheel__arm lp-roadmap__cards">
            {STAGES.map((s, i) => (
              <li key={s.n} data-rcard aria-labelledby={`stage-${s.n}`} className="lp-rcard" style={{ "--i": i, "--c": s.tone } as CSSProperties}>
                <div aria-hidden="true" className="lp-rcard__band">
                  <span className="lp-rcard__num">
                    {s.n}
                    <span className="lp-rcard__word uppercase">{s.word}</span>
                  </span>
                </div>
                <div className="px-[calc(26*var(--u))] pt-[calc(18*var(--u))]">
                  {s.label}
                  <h3 id={`stage-${s.n}`} className="lp-h3 mt-3 text-[max(1.0625rem,calc(28*var(--u)))]">
                    {s.title}
                  </h3>
                </div>
                <ul className="lp-list">
                  {s.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <p className="lp-roadmap__foot text-caption text-muted-foreground">
          <ArrowRight aria-hidden="true" className="size-3.5" />
          Today, Baton works from WhatsApp exports and documents you upload. Try that in the demo.
        </p>
      </div>
    </section>
  );
}
