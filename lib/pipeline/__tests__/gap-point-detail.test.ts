// R3 Task 04: the checklist's `pointDetail` (TypeScript) and `_checklist_point_detail` (SQL, migration
// 20261117400100) must name the same subjects for the same exact questions, and only for categories whose points
// require that attribute. A contact NAME is never derivable from a question.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parsePointAttributes } from "../../contracts/schemas";
import { checklistPointDetail, EXPECTED_KNOWLEDGE_CHECKLIST, GAP_POINT_REQUIRED_FIELD } from "../checklist";

const MIGRATION = readFileSync(join(process.cwd(), "supabase", "migrations", "20261117400100_gap_answer_point_attributes.sql"), "utf8");
const sqlLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe("gap-answer point details", () => {
  it("required fields are exactly the categories whose contract schema rejects empty attributes", () => {
    const failing = EXPECTED_KNOWLEDGE_CHECKLIST.map((i) => i.category)
      .concat(["decision", "risk"] as const)
      .filter((c, k, all) => all.indexOf(c) === k)
      .filter((c) => !parsePointAttributes(c, {}).success);
    assert.deepEqual(failing.sort(), Object.keys(GAP_POINT_REQUIRED_FIELD).sort());
  });

  it("every pointDetail fills the required attribute and yields valid attributes", () => {
    for (const item of EXPECTED_KNOWLEDGE_CHECKLIST.filter((i) => i.pointDetail)) {
      const field = GAP_POINT_REQUIRED_FIELD[item.category];
      assert.ok(field, `${item.key}: pointDetail only where an attribute is required`);
      assert.ok(parsePointAttributes(item.category, { [field]: item.pointDetail }).success, item.key);
    }
  });

  it("the SQL mapping matches the checklist exactly", () => {
    const withDetail = EXPECTED_KNOWLEDGE_CHECKLIST.filter((i) => i.pointDetail);
    for (const item of withDetail) {
      assert.ok(MIGRATION.includes(`p_category = '${item.category}' and p_question = ${sqlLiteral(item.question)}`), `${item.key}: question in SQL`);
      assert.ok(MIGRATION.includes(`then ${sqlLiteral(item.pointDetail!)}`), `${item.key}: detail in SQL`);
    }
    const sqlBranches = MIGRATION.match(/when p_category = '[a-z_]+' and p_question = /g) ?? [];
    assert.equal(sqlBranches.length, withDetail.length, "no SQL branch without a checklist entry");
  });

  it("a contact name is never derived; lookups are exact", () => {
    const contact = EXPECTED_KNOWLEDGE_CHECKLIST.find((i) => i.category === "contact")!;
    assert.equal(checklistPointDetail("contact", contact.question), null);
    assert.equal(checklistPointDetail("account_access", "Who holds the bank or UPI account, and how is access handed over?"), "Bank or UPI account");
    assert.equal(checklistPointDetail("account_access", "who holds the bank or upi account, and how is access handed over?"), null);
    assert.equal(checklistPointDetail("owner", "Who holds the bank or UPI account, and how is access handed over?"), null);
    assert.equal(checklistPointDetail(null, "anything"), null);
  });
});
