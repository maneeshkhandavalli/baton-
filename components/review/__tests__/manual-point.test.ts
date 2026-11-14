// P1-1: the review workspace's "Add a point" dialog builds a createManualPoint input the shared schema accepts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POINT_CATEGORIES } from "../../../lib/contracts/enums";
import { createManualPointInput, pointAttributesSchemas } from "../../../lib/contracts/schemas";
import { attributesFor, blankManualForm, buildManualPointInput, MANUAL_FIELDS } from "../manual-point";

const H = "11111111-1111-4111-8111-111111111111";
const REQUIRED: Record<string, string> = { responsibility: "Runs the stall rota", nameLabel: "Venue manager", system: "Club bank account" };

describe("manual point fields mirror the contract", () => {
  for (const category of POINT_CATEGORIES) {
    it(`${category}: every schema attribute is offered (except directContact) and the blank form parses`, () => {
      const offered = MANUAL_FIELDS[category].map((f) => f.key).sort();
      const schemaKeys = Object.keys(pointAttributesSchemas[category].shape).filter((k) => k !== "directContact").sort();
      assert.deepEqual(offered, schemaKeys);

      const form = { ...blankManualForm(category), title: "T", statement: "S" };
      for (const f of MANUAL_FIELDS[category]) if (f.required) form.fields[f.key] = REQUIRED[f.key];
      const built = buildManualPointInput(H, form);
      assert.ok(built.ok, JSON.stringify(!built.ok && built.fieldErrors));
    });
  }
});

describe("buildManualPointInput", () => {
  it("blank optional text becomes null, lists split on commas, testimony is attached", () => {
    const form = {
      ...blankManualForm("decision"),
      title: "  Workshop fee  ",
      statement: "Workshops are free for members.",
      fields: { decidedAt: " ", decidedByLabel: "Core team", alternativesConsidered: "₹100 fee, , free for all" },
      testimony: "I was in the leads call on 18 Sept.",
    };
    const built = buildManualPointInput(H, form);
    assert.ok(built.ok);
    assert.equal(built.input.title, "Workshop fee");
    assert.deepEqual(built.input.attributes, { decidedAt: null, decidedByLabel: "Core team", rationale: null, alternativesConsidered: ["₹100 fee", "free for all"] });
    assert.deepEqual(built.input.testimony, { text: "I was in the leads call on 18 Sept." });
    assert.equal("accessOverride" in built.input, false);
    assert.ok(createManualPointInput.safeParse(built.input).success);
  });

  it("reports missing title/statement and a missing required attribute by field", () => {
    const built = buildManualPointInput(H, { ...blankManualForm("owner"), title: "", statement: "" });
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.ok(built.fieldErrors.title);
    assert.ok(built.fieldErrors.statement);
    assert.match(built.fieldErrors["attr.responsibility"]?.[0] ?? "", /Required/);
  });

  it("an invalid date is a field error, a valid one passes", () => {
    const bad = buildManualPointInput(H, { ...blankManualForm("open_task"), title: "T", statement: "S", fields: { dueDate: "2026-13-45" } });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.ok(bad.fieldErrors["attr.dueDate"]);
    const good = buildManualPointInput(H, { ...blankManualForm("open_task"), title: "T", statement: "S", fields: { dueDate: "2026-12-01" } });
    assert.ok(good.ok);
  });

  it("a contact never carries a typed-in direct contact", () => {
    const form = { ...blankManualForm("contact"), title: "T", statement: "S", fields: { nameLabel: "Venue manager" } };
    assert.equal(attributesFor(form).directContact, null);
  });

  it("an access override is passed through only when chosen", () => {
    const built = buildManualPointInput(H, { ...blankManualForm("risk"), title: "T", statement: "S", accessOverride: "leads_only" });
    assert.ok(built.ok);
    assert.equal(built.input.accessOverride, "leads_only");
  });
});
