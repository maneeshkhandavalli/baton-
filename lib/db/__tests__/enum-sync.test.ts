// The SQL CHECK lists must match the canonical TypeScript enums (D20). Fails if either side drifts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import * as E from "../../contracts/enums";

const sql = readFileSync(new URL("../../../supabase/migrations/20261111000100_schema.sql", import.meta.url), "utf8");

function tableBody(table: string): string {
  const m = sql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(m, `table ${table} not found`);
  return m[1] as string;
}

function checkList(table: string, column: string): string[] {
  const body = tableBody(table);
  const m = body.match(new RegExp(`\\b${column} text[^\\n]*?(?:\\n\\s*)?check \\(${column} in \\(([^)]*)\\)\\)`));
  assert.ok(m, `${table}.${column} has no IN-list CHECK`);
  return [...(m[1] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}

const EXPECTED: Array<[string, string, readonly string[]]> = [
  ["handovers", "state", E.HANDOVER_STATES],
  ["handover_members", "role", E.MEMBER_ROLES],
  ["handover_members", "clearance", E.ACCESS_LEVELS],
  ["access_tokens", "purpose", E.TOKEN_PURPOSES],
  ["access_tokens", "grant_role", E.MEMBER_ROLES],
  ["sources", "kind", E.SOURCE_KINDS],
  ["sources", "state", E.SOURCE_STATES],
  ["sources", "access_level", E.ACCESS_LEVELS],
  ["sources", "date_order", E.DATE_ORDERS],
  ["source_exclusions", "kind", E.EXCLUSION_KINDS],
  ["source_exclusions", "requested_via", E.EXCLUSION_REQUESTED_VIA],
  ["source_exclusions", "participant_identity_kind", E.IDENTITY_KINDS],
  ["source_exclusions", "parse_date_order", E.DATE_ORDERS],
  ["source_participants", "identity_kind", E.IDENTITY_KINDS],
  ["evidence_quotes", "author_identity_kind", E.IDENTITY_KINDS],
  ["participant_erasures", "identity_kind", E.IDENTITY_KINDS],
  ["source_identity_confirmations", "decision", E.IDENTITY_MATCH_DECISIONS],
  ["source_messages", "kind", E.MESSAGE_KINDS],
  ["processing_runs", "status", E.RUN_STATUSES],
  ["handover_points", "category", E.POINT_CATEGORIES],
  ["handover_points", "origin", E.POINT_ORIGINS],
  ["handover_points", "evidence_status", E.EVIDENCE_STATUSES],
  ["handover_points", "review_state", E.REVIEW_STATES],
  ["handover_points", "privacy_review", E.PRIVACY_REVIEW_STATES],
  ["point_revisions", "redaction_kind", E.REDACTION_KINDS],
  ["gap_questions", "priority", E.GAP_PRIORITIES],
  ["gap_questions", "status", E.GAP_QUESTION_STATUSES],
  ["gap_answers", "status", E.GAP_ANSWER_STATUSES],
  ["evidence_quotes", "kind", E.EVIDENCE_KINDS],
  ["evidence_quotes", "quote_check", E.QUOTE_CHECKS],
  ["point_evidence", "support_verdict", E.SUPPORT_VERDICTS],
  ["review_actions", "action", E.REVIEW_ACTION_TYPES],
  ["processing_jobs", "stage", E.PIPELINE_STAGES],
  ["processing_jobs", "status", E.RUN_STATUSES],
  ["publication_points", "category", E.POINT_CATEGORIES],
];

describe("enum CHECK lists match lib/contracts/enums.ts", () => {
  for (const [table, column, values] of EXPECTED) {
    it(`${table}.${column}`, () => {
      assert.deepEqual(checkList(table, column), [...values]);
    });
  }

  it("every identity-pepper column only allows the enum's versions (p1)", () => {
    const versions = [...sql.matchAll(/pepper_version text[^,\n]*check \(\w+ = '([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(versions.length >= 3);
    assert.ok(versions.every((v) => (E.IDENTITY_PEPPER_VERSIONS as readonly string[]).includes(v as string)));
  });
});
