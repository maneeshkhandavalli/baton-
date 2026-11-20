// New-handover wizard: a source waiting for "day/month or month/day?" holds Continue and Start processing
// (the run would fail with date_format_ambiguous). Removing it clears the hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { blankSource, DATE_ORDER_REQUIRED_REASON, needsAnswerReason, sourcesNeedingAnswer } from "../draft-state";

const source = (name: string, over: Partial<Parameters<typeof blankSource>[0]> = {}) =>
  blankSource({ localId: name, name, size: 10, kind: "whatsapp_export", status: "ready", ...over });
const waiting = (name: string) => source(name, { status: "error", needsDateOrder: true, errorPhase: "needs_input" });

describe("sources needing an answer", () => {
  it("only a source asking for its date order counts; ready, busy and failed ones do not", () => {
    const list = [
      source("a.txt"),
      waiting("chat.txt"),
      source("b.txt", { status: "previewing" }),
      source("c.txt", { status: "error", errorPhase: "failed", error: "Upload failed" }),
    ];
    assert.deepEqual(sourcesNeedingAnswer(list).map((s) => s.name), ["chat.txt"]);
  });

  it("removing the unanswered source clears the hold", () => {
    const list = [source("a.txt"), waiting("chat.txt")];
    assert.deepEqual(sourcesNeedingAnswer(list.filter((s) => s.name !== "chat.txt")), []);
    assert.equal(needsAnswerReason([]), null);
  });

  it("the message names each file and says to answer first", () => {
    assert.equal(needsAnswerReason([waiting("chat.txt")]), "Answer the date order question for chat.txt first.");
    assert.equal(needsAnswerReason([waiting("chat.txt")], " in Sources"), "Answer the date order question for chat.txt in Sources first.");
    assert.equal(
      needsAnswerReason([waiting("a.txt"), waiting("b.txt"), waiting("c.txt")]),
      "Answer the date order questions for a.txt, b.txt and c.txt first.",
    );
    assert.doesNotMatch(needsAnswerReason([waiting("a.txt"), waiting("b.txt")])!, /—/, "no em dash");
  });

  it("the server's refusal reason is the same literal as lib/actions/core/handovers.ts", () => {
    assert.equal(DATE_ORDER_REQUIRED_REASON, "date_order_required");
    assert.match(readFileSync(join(process.cwd(), "lib/actions/core/handovers.ts"), "utf8"), /DATE_ORDER_REQUIRED_REASON = "date_order_required"/);
  });
});

// Static wiring checks for the .tsx files test:ui cannot transpile.
describe("wizard wiring", () => {
  const wizard = readFileSync(join(process.cwd(), "components/wizard/new-handover-wizard.tsx"), "utf8");
  const step = readFileSync(join(process.cwd(), "components/wizard/sources-step.tsx"), "utf8");

  it("Continue on Sources and Start processing send the creator to the question instead of moving on", () => {
    assert.match(wizard, /shownStep === 2 && unanswered\.length > 0 \? showUnanswered\(\) : setStep\(shownStep \+ 1\)/);
    assert.match(wizard, /async function finish\(\) \{\s*if \(!handoverId\) return;\s*if \(unanswered\.length > 0\) return showUnanswered\(\);/);
    assert.match(wizard, /shownStep >= 2 && unanswered\.length > 0\s*\? needsAnswerReason\(unanswered/);
  });

  it("a date_order_required refusal from the server marks the source and shows its question", () => {
    assert.match(wizard, /e\.details\?\.reason === DATE_ORDER_REQUIRED_REASON/);
    assert.match(wizard, /showUnanswered\(waiting\.localId\)/);
  });

  it("the row scrolls into view and focuses its date order buttons", () => {
    assert.match(step, /focusRequest=\{attention\?\.localId === s\.localId \? attention\.nonce : undefined\}/);
    assert.match(step, /row\.scrollIntoView\(/);
    assert.match(step, /querySelector<HTMLElement>\("\[data-date-order\] button"\)/);
    assert.match(step, /<span data-date-order /);
  });
});
