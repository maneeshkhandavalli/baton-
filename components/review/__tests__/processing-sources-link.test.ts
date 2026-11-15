import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// QA-UI3-H1 (static wiring check; the view is a client component the node test loader cannot render).
// The wizard (app/(workspace)/handover/new/page.tsx) redirects any draft with a parsed or parsing source back
// to the processing page, so the failed-run action must not link there in that case.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("processing view: source management after a failed run", () => {
  it("links to Settings → Sources once a source was read, and to the wizard only before that", () => {
    const view = read("components/processing/processing-view.tsx");
    assert.match(view, /sources\.some\(\(s\) => s\.state === "parsed" \|\| s\.state === "parsing"\) \?/);
    assert.match(view, /routes\.handover\.settings\(handoverId\)\}#sources/);
    assert.match(view, /Manage sources/);
    const wizard = read("app/(workspace)/handover/new/page.tsx");
    assert.match(wizard, /live\.some\(\(s\) => s\.state === "parsed" \|\| s\.state === "parsing"\)/, "wizard redirect rule changed: revisit the processing link");
    assert.match(read("components/settings/handover-settings.tsx"), /<Panel id="sources">/);
  });
});
