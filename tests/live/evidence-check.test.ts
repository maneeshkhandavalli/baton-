// Offline unit tests for tests/live/evidence-check.ts (synthetic inputs only, no network):
//   node --import ./tests/live/resolve-live.mjs --test tests/live/evidence-check.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  datesIn,
  inventedOwnerOrDate,
  quotesAreVerbatim,
  stripChatTimestamps,
  unsupportedAttributes,
} from "./evidence-check";

describe("quotesAreVerbatim", () => {
  const bodies = new Map([
    ["m1", "We decided to move the debate to the Library Auditorium because the Main Hall is closed."],
    ["m2", "Ravi said “the  budget   is due” — by Friday."],
  ]);

  it("accepts exact and normalized substrings of the cited body", () => {
    assert.deepEqual(
      quotesAreVerbatim(
        [
          { id: "q1", quote_text: "move the debate to the Library Auditorium", quote_check: "exact", source_message_id: "m1" },
          { id: "q2", quote_text: 'said "the budget is due" - by Friday', quote_check: "normalized", source_message_id: "m2" },
        ],
        bodies,
      ),
      [],
    );
  });

  it("skips quotes that make no verbatim claim", () => {
    assert.deepEqual(
      quotesAreVerbatim(
        [
          { id: "q1", quote_text: "invented words never said", quote_check: "not_found", source_message_id: "m1" },
          { id: "q2", quote_text: "invented words never said", quote_check: "pending", source_message_id: null },
        ],
        bodies,
      ),
      [],
    );
  });

  it("reports paraphrases, wrong messages, missing messages and exact claims that only match normalized", () => {
    const v = quotesAreVerbatim(
      [
        { id: "a", quote_text: "moved the debate to the auditorium", quote_check: "exact", source_message_id: "m1" },
        { id: "b", quote_text: "move the debate to the Library Auditorium", quote_check: "normalized", source_message_id: "m2" },
        { id: "c", quote_text: "move the debate to the Library Auditorium", quote_check: "exact", source_message_id: null },
        { id: "d", quote_text: "move the debate", quote_check: "exact", source_message_id: "gone" },
        { id: "e", quote_text: 'said "the budget is due"', quote_check: "exact", source_message_id: "m2" },
        { id: "f", quote_text: "MOVE THE DEBATE to the Library", quote_check: "normalized", source_message_id: "m1" }, // case is preserved
      ],
      bodies,
    );
    assert.deepEqual(
      v.map((x) => [x.quoteId, x.reason]),
      [
        ["a", "not_exact_substring"],
        ["b", "not_normalized_substring"],
        ["c", "missing_message"],
        ["d", "missing_message"],
        ["e", "not_exact_substring"],
        ["f", "not_normalized_substring"],
      ],
    );
  });
});

describe("datesIn", () => {
  it("reads ISO, numeric day-first, and written dates", () => {
    assert.deepEqual(datesIn("2026-11-20"), [{ y: 2026, m: 11, d: 20 }]);
    assert.deepEqual(datesIn("by 28/11/2026."), [{ y: 2026, m: 11, d: 28 }]);
    assert.deepEqual(datesIn("by 05.12.26"), [{ y: 2026, m: 12, d: 5 }]);
    assert.deepEqual(datesIn("on 3/4", "mdy"), [{ y: null, m: 3, d: 4 }]);
    assert.deepEqual(datesIn("by 20 November 2026"), [{ y: 2026, m: 11, d: 20 }]);
    assert.deepEqual(datesIn("the 1st of Dec"), [{ y: null, m: 12, d: 1 }]);
    assert.deepEqual(datesIn("Nov 25, 2026"), [{ y: 2026, m: 11, d: 25 }]);
    assert.deepEqual(datesIn("this week, before the debate, 100 people, 18:00"), []);
    assert.deepEqual(datesIn("31/02/2026 and 45/13/2026"), [{ y: 2026, m: 2, d: 31 }]); // only month/day ranges are checked
  });
});

describe("unsupportedAttributes", () => {
  const source = stripChatTimestamps(
    [
      "13/11/2026, 18:11 - Asha Rao: Ravi Kumar will submit the event budget by 20 November 2026.",
      "13/11/2026, 18:15 - Ravi Kumar: Asha Rao will hand over the receipts to Meera by 28/11/2026.",
      "14/11/2026, 09:38 - Asha Rao: Ravi Kumar holds the login for the society Instagram page.",
      "14/11/2026, 09:44 - Asha Rao: Next step is for Meera to meet the faculty advisor.",
    ].join("\n"),
  );

  it("accepts labels and dates that appear in the source, in either date format", () => {
    assert.deepEqual(
      unsupportedAttributes(
        [
          { category: "open_task", attributes: { assigneeLabel: "Ravi Kumar", dueDate: "2026-11-20", progressNote: null } },
          { category: "open_task", attributes: { assigneeLabel: "Asha", dueDate: "2026-11-28" } },
          { category: "open_task", attributes: { assigneeLabel: null, dueDate: null } },
          { category: "open_task", attributes: { assigneeLabel: "Unassigned", dueDate: null } },
          { category: "next_action", attributes: { actorLabel: "Meera", byWhen: "this week" } },
          { category: "next_action", attributes: { actorLabel: "Meera's", byWhen: "20 Nov" } },
          { category: "account_access", attributes: { system: "Instagram", holderLabel: "Ravi Kumar (the society)" } },
          { category: "owner", attributes: { responsibility: "receipts", ownerLabel: "Mr. Ravi" } },
          { category: "owner", attributes: { responsibility: "handover", ownerLabel: "Meera (incoming secretary)" } },
          { category: "decision", attributes: { decidedByLabel: "The whole committee" } }, // not checked
          { category: "risk", attributes: null },
        ],
        source,
      ),
      [],
    );
  });

  it("reports invented people and dates, including a message timestamp passed off as a deadline", () => {
    const v = unsupportedAttributes(
      [
        { category: "open_task", attributes: { assigneeLabel: "Kiran Shah", dueDate: "2026-11-20" } },
        { category: "open_task", attributes: { assigneeLabel: "Ravi Kumar", dueDate: "2026-11-21" } },
        { category: "open_task", attributes: { assigneeLabel: "Meera", dueDate: "2026-11-13" } }, // only a timestamp date
        { category: "open_task", attributes: { assigneeLabel: "Meera", dueDate: "2025-11-20" } }, // wrong year
        { category: "next_action", attributes: { actorLabel: "the treasurer", byWhen: "by 2026-12-01" } },
        { category: "owner", attributes: { responsibility: "x", ownerLabel: "Priya" } },
        { category: "account_access", attributes: { system: "Instagram", holderLabel: "Asha Rao and Kiran" } },
      ],
      source,
    );
    assert.deepEqual(
      v.map((x) => [x.index, x.field, x.reason]),
      [
        [0, "assigneeLabel", "label_not_in_source"],
        [1, "dueDate", "date_not_in_source"],
        [2, "dueDate", "date_not_in_source"],
        [3, "dueDate", "date_not_in_source"],
        [4, "actorLabel", "label_not_in_source"],
        [4, "byWhen", "date_not_in_source"],
        [5, "ownerLabel", "label_not_in_source"],
        [6, "holderLabel", "label_not_in_source"],
      ],
    );
  });

  it("strips Android and iOS line timestamps but keeps sender names and in-message dates", () => {
    assert.equal(stripChatTimestamps("13/11/2026, 18:11 - Asha Rao: due 20/11/2026"), "Asha Rao: due 20/11/2026");
    assert.equal(stripChatTimestamps("[13/11/26, 6:11:05 PM] Asha Rao: hi"), "Asha Rao: hi");
  });
});

describe("the round2 Gemini e2e fixture supports its own planted attributes", () => {
  const text = stripChatTimestamps(readFileSync(new URL("../../fixtures/demo/round2-gemini-e2e.txt", import.meta.url), "utf8"));

  it("no timestamp dates survive stripping; the three deadlines do", () => {
    const dates = datesIn(text).map((d) => `${d.y}-${d.m}-${d.d}`).sort();
    assert.deepEqual(dates, ["2026-11-20", "2026-11-25", "2026-11-28"]);
  });

  it("an ideal extraction has no violations", () => {
    assert.deepEqual(
      unsupportedAttributes(
        [
          { category: "open_task", attributes: { assigneeLabel: "Ravi Kumar", dueDate: "2026-11-20" } },
          { category: "open_task", attributes: { assigneeLabel: "Meera Iyer", dueDate: "2026-11-25" } },
          { category: "open_task", attributes: { assigneeLabel: "Asha Rao", dueDate: "2026-11-28" } },
          { category: "open_task", attributes: { assigneeLabel: null, dueDate: null } },
          { category: "next_action", attributes: { actorLabel: "Meera", byWhen: null } },
          { category: "account_access", attributes: { system: "Instagram", holderLabel: "Ravi Kumar" } },
        ],
        text,
      ),
      [],
    );
  });
});

describe("inventedOwnerOrDate", () => {
  const ownerless = new Set(["m-ownerless"]);

  it("flags an owner or date attached to a task cited only from the owner-less message", () => {
    const v = inventedOwnerOrDate(
      [
        { category: "open_task", attributes: { assigneeLabel: null, dueDate: null }, messageIds: ["m-ownerless"] },
        { category: "open_task", attributes: { assigneeLabel: "Unknown", dueDate: null }, messageIds: ["m-ownerless"] },
        { category: "open_task", attributes: { assigneeLabel: "Meera", dueDate: "2026-11-30" }, messageIds: ["m-ownerless"] },
        { category: "next_action", attributes: { actorLabel: "Asha", byWhen: null }, messageIds: ["m-ownerless"] },
        // Also cited from another message that may name an owner: not judged.
        { category: "open_task", attributes: { assigneeLabel: "Ravi", dueDate: null }, messageIds: ["m-ownerless", "m-other"] },
        // Not a task, or no verified evidence: not judged.
        { category: "risk", attributes: { mitigation: "x" }, messageIds: ["m-ownerless"] },
        { category: "open_task", attributes: { assigneeLabel: "Ravi", dueDate: null }, messageIds: [] },
      ],
      ownerless,
    );
    assert.deepEqual(
      v.map((x) => [x.index, x.field, x.value]),
      [
        [2, "assigneeLabel", "Meera"],
        [2, "dueDate", "2026-11-30"],
        [3, "actorLabel", "Asha"],
      ],
    );
  });
});
