import { FlaskConical } from "lucide-react";

/**
 * The label for what is built in code but not yet set up with real apps or verified live (the GitHub, Discord,
 * Telegram and Slack connectors, and the bot-driven parts of Living Handovers). Never says "available" or implies
 * a live sync. Distinct from "Works today" (solid) and "Preview" (dashed).
 */
export function EarlyAccessLabel() {
  return (
    <span className="bi-tag" data-tone="early">
      <FlaskConical aria-hidden="true" className="size-3" />
      Early access
    </span>
  );
}
