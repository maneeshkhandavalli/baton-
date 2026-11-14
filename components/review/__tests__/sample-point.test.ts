// PROTOTYPE "Fill with sample data" in the review sections: every category's sample respects the shared schema,
// stays editable, fills only its own point, and never silently replaces the user's own writing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HANDOVER_SECTIONS } from "../../handover/labels";
import { POINT_CATEGORIES } from "../../../lib/contracts/enums";
import { CODECELL_SAMPLE_POINTS, SAMPLE_POINT_TITLE_PREFIX } from "../../../lib/prototype/sample-data/codecell";
import { blankManualForm, buildManualPointInput, MANUAL_FIELDS } from "../manual-point";
import { hasContent, sameContent, sampleForm, wouldOverwriteUserContent } from "../sample-point";

const H = "11111111-1111-4111-8111-111111111111";

describe("section samples respect the createManualPoint schema", () => {
  for (const category of POINT_CATEGORIES) {
    it(`${category}: the sample builds a valid input, labelled as sample, with only offered fields and no testimony`, () => {
      const form = sampleForm(category, CODECELL_SAMPLE_POINTS[category]);
      assert.equal(form.category, category);
      assert.ok(form.title.startsWith(SAMPLE_POINT_TITLE_PREFIX), "demo points are visibly demo points");
      const offered = new Set(MANUAL_FIELDS[category].map((f) => f.key));
      for (const k of Object.keys(form.fields)) assert.ok(offered.has(k), `${k} is not offered for ${category}`);
      assert.equal(form.testimony, "", "testimony is credited to the user, so a sample never fills it");
      const built = buildManualPointInput(H, form);
      assert.ok(built.ok, built.ok ? "" : JSON.stringify(built.fieldErrors));
    });
  }

  it("every handover section has a sample for the category its action uses", () => {
    for (const s of HANDOVER_SECTIONS) assert.ok(CODECELL_SAMPLE_POINTS[s.categories[0]], s.id);
  });

  it("a sample attribute the editor does not offer is dropped, so the schema cannot be widened", () => {
    const form = sampleForm("decision", { title: "Sample: x", statement: "y", fields: { rationale: "r", directContact: "z", unknown: "u" } });
    assert.deepEqual(Object.keys(form.fields), ["rationale"]);
  });

  it("filling one point does not touch another: forms are independent copies", () => {
    const a = sampleForm("owner", CODECELL_SAMPLE_POINTS.owner);
    const b = sampleForm("owner", CODECELL_SAMPLE_POINTS.owner);
    a.fields.ownerLabel = "Edited";
    assert.notEqual(b.fields.ownerLabel, "Edited");
    assert.notEqual(CODECELL_SAMPLE_POINTS.owner.fields.ownerLabel, "Edited", "the shared fixture is never mutated");
  });
});

describe("no silent overwrite of user-written content", () => {
  const sample = sampleForm("risk", CODECELL_SAMPLE_POINTS.risk);

  it("an empty form is filled without asking", () => {
    assert.equal(wouldOverwriteUserContent(blankManualForm("risk"), null), false);
    assert.equal(hasContent(blankManualForm("risk")), false);
  });

  it("anything the user typed (title, statement, attribute or testimony) requires confirmation", () => {
    for (const patch of [{ title: "My risk" }, { statement: "Mine" }, { testimony: "I saw it" }, { fields: { mitigation: "Mine" } }]) {
      assert.equal(wouldOverwriteUserContent({ ...blankManualForm("risk"), ...patch }, null), true, JSON.stringify(patch));
    }
  });

  it("an untouched sample can be refilled without asking; an edited sample is the user's writing and asks", () => {
    assert.equal(wouldOverwriteUserContent(sample, sample), false);
    const edited = { ...sample, statement: `${sample.statement} Edited by me.` };
    assert.equal(wouldOverwriteUserContent(edited, sample), true);
    assert.equal(sameContent(edited, sample), false);
  });

  it("sample content stays editable: an edited sample still builds a valid input", () => {
    const edited = { ...sample, title: "Lab booking could lapse (checked)", fields: { ...sample.fields, mitigation: "Email the office on Wednesday" } };
    assert.ok(buildManualPointInput(H, edited).ok);
  });
});
