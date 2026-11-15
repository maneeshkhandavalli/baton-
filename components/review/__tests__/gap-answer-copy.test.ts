import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// QA-UI3-G1: the Gaps page tells reviewers what accepting does for both kinds of question, and the migration
// that makes it true exists (behaviour is tested on Postgres in supabase/tests/sql/99_gap_answer_point.sql).
describe("gap answers: accepted answers reach the handover", () => {
  it("the Gaps page explains both cases", () => {
    const src = readFileSync(join(process.cwd(), "components/gaps/gaps-manager.tsx"), "utf8");
    assert.match(src, /An answer to a general question becomes a new point for you to review before publishing\./);
  });
  it("review_gap_answer creates a pending gap_answer point for unlinked questions and links the question", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261115100100_gap_answer_point.sql"), "utf8");
    assert.match(sql, /create or replace function public\.review_gap_answer\(p_actor_profile_id uuid, p_answer_id uuid, p_decision text, p_note text default null\)/);
    assert.match(sql, /security definer\s+set search_path = ''/);
    assert.match(sql, /insert into public\.handover_points \(handover_id, category, origin, sort_key\)/);
    assert.match(sql, /'gap_answer'/);
    assert.match(sql, /update public\.gap_questions set point_id = v_point/);
    assert.ok(!/review_state\s*=\s*'approved'/.test(sql), "never approves on the reviewer's behalf");
  });
});
