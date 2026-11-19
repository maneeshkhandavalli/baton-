import { CircleDot } from "lucide-react";

/**
 * The one label every not-yet-available idea on the landing page carries. Dashed pill, so it never reads like the
 * solid "Works today" tag.
 */
export function PreviewLabel() {
  return (
    <span className="bi-tag" data-tone="preview">
      <CircleDot aria-hidden="true" className="size-3" />
      Preview
    </span>
  );
}
