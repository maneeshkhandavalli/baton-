import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("landing: Round 3 previews", () => {
  const src = read("components/marketing/coming-next.tsx");
  it("are clearly labelled and say they are not available yet", () => {
    assert.match(src, /Coming in Round 3/);
    assert.match(src, /not features you can use today/);
    assert.equal((src.match(/<PreviewLabel \/>/g) ?? []).length, 1, "one label rendered per preview item");
    for (const title of ["Discord and Telegram bots", "Ask the Handover", "Living Handover"]) assert.ok(src.includes(title), title);
  });
  it("contain no working-looking controls (no buttons, inputs, links or handlers)", () => {
    for (const bad of ["<button", "<input", "<textarea", "<select", "onClick", "href=", "<Link", "<form"]) assert.ok(!src.includes(bad), bad);
  });
  it("give Discord and Telegram the same space", () => {
    assert.match(src, /<Pane label="Discord ·/);
    assert.match(src, /<Pane label="Telegram ·/);
    assert.match(src, /grid gap-3 sm:grid-cols-2/);
  });
  it("sit on the landing page", () => assert.match(read("app/(marketing)/page.tsx"), /<ComingNext \/>/));
});

describe("landing: For the nerds", () => {
  it("covers the five required topics, collapsed by default", () => {
    const src = read("components/marketing/for-the-nerds.tsx");
    for (const t of ["PII masking and privacy", "Evidence and source traceability", "AI extraction and verification", "Human review", "Publishing and access controls"]) assert.ok(src.includes(`title: "${t}"`), t);
    assert.match(src, /<details key=\{t\.title\}/);
    assert.ok(!/<details[^>]*\bopen\b/.test(src), "no topic opens by default");
  });
});
