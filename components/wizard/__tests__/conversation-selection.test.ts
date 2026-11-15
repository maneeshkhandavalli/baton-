import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deselectAll, selectAll, selectionSummary, toggleConversation } from "../conversation-selection";

const convs = [
  { localId: "c_1", messageCount: 9 },
  { localId: "c_2", messageCount: 1 },
  { localId: "c_3", messageCount: 5 },
];

describe("wizard conversation selector", () => {
  it("summarises selected conversations and messages", () => {
    assert.deepEqual(selectionSummary(convs, []), { selected: 3, total: 3, selectedMessages: 15, totalMessages: 15 });
    assert.deepEqual(selectionSummary(convs, ["c_1"]), { selected: 2, total: 3, selectedMessages: 6, totalMessages: 15 });
  });
  it("select all and deselect all produce the stored exclusion list (processing input unchanged)", () => {
    assert.deepEqual(selectAll(), []);
    assert.deepEqual(deselectAll(convs), ["c_1", "c_2", "c_3"]);
    assert.equal(selectionSummary(convs, deselectAll(convs)).selected, 0);
  });
  it("toggles one conversation in and out", () => {
    assert.deepEqual(toggleConversation([], "c_2"), ["c_2"]);
    assert.deepEqual(toggleConversation(["c_2", "c_3"], "c_2"), ["c_3"]);
  });
  it("the scope step renders the compact selector, collapsed by default, and keeps the date range", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../scope-step.tsx", import.meta.url), "utf8");
    assert.match(src, /Select all/);
    assert.match(src, /Deselect all/);
    assert.match(src, /messages selected/);
    assert.match(src, /<details className="group">/);
    assert.ok(!/<details[^>]*\bopen\b/.test(src), "previews are collapsed by default");
    assert.match(src, /legend="Dates to read"/);
    assert.match(src, /excludedConversations: toggleConversation\(/);
  });
});
