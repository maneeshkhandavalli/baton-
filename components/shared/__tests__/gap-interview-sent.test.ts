import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeSent, parseSent, remainingQuestions, sentStorageKey } from "../../gap-interview/sent-questions";

// Round 4 audit C4: after a partial submission, the link shows only the questions still to answer on this device.
describe("Gap Interview: remaining questions after a partial submission", () => {
  const qs = [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }];
  it("hides the questions this device already answered", () => {
    const sent = parseSent(mergeSent(new Set(), ["q1", "q3"], qs.map((q) => q.id)));
    assert.deepEqual(remainingQuestions(qs, sent).map((q) => q.id), ["q2", "q4"]);
  });
  it("keeps adding across submissions and forgets questions no longer on the link", () => {
    const first = parseSent(mergeSent(new Set(), ["q1"], ["q1", "q2", "q3", "q4"]));
    const second = parseSent(mergeSent(first, ["q2"], ["q2", "q3", "q4"]));
    assert.deepEqual([...second].sort(), ["q2"]);
  });
  it("ignores junk and keys by token prefix", () => {
    assert.equal(parseSent("{").size, 0);
    assert.equal(parseSent('{"a":1}').size, 0);
    assert.deepEqual([...parseSent('["q1",2]')], ["q1"]);
    assert.equal(sentStorageKey("abcdefghijklmnop"), "baton:gap-sent:abcdefghijkl");
  });
});
