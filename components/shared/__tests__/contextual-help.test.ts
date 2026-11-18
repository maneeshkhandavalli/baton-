// R3 Task 06: contextual help open/close rules and copy (components/shared/contextual-help*.ts, help-topics.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { helpReducer, helpTriggerAria, INITIAL_HELP_STATE } from "../contextual-help-state";
import { HELP_TOPICS, OUTDATED_AFTER_DAYS } from "../help-topics";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("contextual help state", () => {
  it("toggle opens and closes (click, tap, Enter and Space all fire the button's click)", () => {
    const open = helpReducer(INITIAL_HELP_STATE, { type: "toggle" });
    assert.deepEqual(open, { open: true, restoreFocus: false });
    assert.deepEqual(helpReducer(open, { type: "toggle" }), { open: false, restoreFocus: false });
  });

  it("Escape closes and returns focus to the trigger; it does nothing when closed", () => {
    const open = helpReducer(INITIAL_HELP_STATE, { type: "toggle" });
    assert.deepEqual(helpReducer(open, { type: "escape" }), { open: false, restoreFocus: true });
    assert.equal(helpReducer(INITIAL_HELP_STATE, { type: "escape" }), INITIAL_HELP_STATE);
  });

  it("a press outside or focus leaving closes without stealing focus back", () => {
    const open = helpReducer(INITIAL_HELP_STATE, { type: "toggle" });
    for (const type of ["outside_press", "focus_left", "close"] as const) {
      assert.deepEqual(helpReducer(open, { type }), { open: false, restoreFocus: false });
      assert.equal(helpReducer(INITIAL_HELP_STATE, { type }), INITIAL_HELP_STATE);
    }
  });

  it("the trigger always controls the panel and is described by it only while it is shown", () => {
    assert.deepEqual(helpTriggerAria(false, "p1"), { "aria-expanded": false, "aria-controls": "p1" });
    assert.deepEqual(helpTriggerAria(true, "p1"), { "aria-expanded": true, "aria-controls": "p1", "aria-describedby": "p1" });
  });

  it("the component is a real button and never relies on hover", () => {
    const src = readFileSync(path.join(ROOT, "components/shared/contextual-help.tsx"), "utf8");
    assert.match(src, /<button[\s\S]*?type="button"/);
    assert.doesNotMatch(src, /onMouseEnter|onMouseOver|onPointerEnter|group-hover:|peer-hover:/);
    assert.match(src, /"Escape"/);
  });
});

describe("help topics", () => {
  it("every topic has a short title and a plain body", () => {
    for (const [id, t] of Object.entries(HELP_TOPICS)) {
      assert.ok(t.title.length > 0 && t.title.length <= 40, id);
      assert.ok(t.body.length > 20 && t.body.length <= 320, id);
      assert.doesNotMatch(`${t.title} ${t.body} ${t.action ?? ""}`, /<|>|TODO/, id);
    }
  });

  it("'possibly outdated' states the same rule as the database (lifecycle.sql: 30 days before the record's end)", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/20261111000400_lifecycle.sql"), "utf8");
    assert.match(sql, new RegExp(`v_last < v_as_of - interval '${OUTDATED_AFTER_DAYS} days'`));
    assert.match(HELP_TOPICS.possibly_outdated.body, new RegExp(`${OUTDATED_AFTER_DAYS} days older`));
  });

  it("the AI judgement is never presented as proof or a review decision (VER-1)", () => {
    assert.match(HELP_TOPICS.ai_judgement.body, /never proof/);
    assert.match(HELP_TOPICS.evidence_sourced.body, /person still decides/);
    assert.doesNotMatch(HELP_TOPICS.quote_check.body, /\bAI\b/);
  });
});
