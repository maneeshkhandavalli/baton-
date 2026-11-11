import { UserX } from "lucide-react";

import { segmentMaskedText } from "./mask-tokens";

const EXCLUDED_DESCRIPTION = "Someone who asked to be left out was mentioned here. Their name was removed before processing.";

/**
 * Renders stored text the way §12.1 requires, wherever masked text is shown (evidence quotes, gap
 * answers, previews, published handovers):
 * - mask tokens such as `[PHONE_1]` as quiet chips explaining the value was masked;
 * - `[EXCLUDED_PARTICIPANT]` as a distinct, muted "excluded participant" chip that never says
 *   "masked", never shows the raw token, and is never linked, counted or editable.
 */
export function MaskedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {segmentMaskedText(text).map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.text}</span>;
        if (seg.kind === "mask") {
          return (
            <span
              key={i}
              title="Masked by Baton before processing. The original value is never stored."
              className="rounded bg-foreground/8 px-1 py-px text-[0.85em] text-muted-foreground"
            >
              {seg.token}
            </span>
          );
        }
        return (
          <span
            key={i}
            role="img"
            aria-label={EXCLUDED_DESCRIPTION}
            title={EXCLUDED_DESCRIPTION}
            data-token="excluded-participant"
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border bg-muted/60 px-1.5 py-px align-baseline font-sans text-[0.8em] text-muted-foreground italic select-none"
          >
            <UserX aria-hidden="true" className="size-[1em] shrink-0" />
            excluded participant
          </span>
        );
      })}
    </span>
  );
}
