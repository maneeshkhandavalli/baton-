import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// QA-UI3-H3 (static wiring check; the page is a server component). Review actions on a draft always fail on the
// server, so the review page must open read-only for a draft, with a reason.
describe("review page on a draft", () => {
  it("is read-only with a reason that points to Processing", () => {
    const page = readFileSync(join(process.cwd(), "app/(workspace)/handover/[id]/review/page.tsx"), "utf8");
    assert.match(page, /: state === "draft"\s*\?[\s\S]{0,260}"Processing didn't finish, so review hasn't opened yet\. Start it again on the Processing page\."/);
    assert.match(page, /readOnly=\{!!readOnlyReason\}/);
  });
});
