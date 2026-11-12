// Round 3 A2 × C1: the wizard's details autosave, end to end below the UI. The wizard's pure helpers
// (components/wizard/details-save.ts: detailsInput, classifySaveError) drive the REAL updateHandoverDetails
// Server Function over the Recording backends, so the contract between Agent 1's UI and Agent 2's action is
// tested as one piece:
//   * the input the wizard sends is accepted, every free-text field is masked before the database sees it,
//     an unknown description is never sent (kept), "" clears the role title;
//   * a stale save (someone else edited) becomes { kind: "stale" } → the wizard reloads and tells the user;
//   * a handover that left draft becomes { kind: "not_draft" } → continue on its processing page;
//   * hidden / forbidden / invalid inputs never leak content and never retry forever.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifySaveError, detailsInput, sameDetails } from "../../components/wizard/details-save";
import { updateHandoverDetails } from "../../lib/actions/handovers";
import { actionWorld } from "./support/actions";
import { handoverRow } from "./support/rows";
import { PLANTED, assertNoLeaks } from "./support/sentinels";

const SEEN = "2026-11-12T10:00:00.000Z";

function world() {
  const w = actionWorld();
  w.userDb.returns("api_get_handover", handoverRow(w.ids.handover));
  return w;
}

describe("A2 × C1: details autosave through the real action", () => {
  it("sends masked text; an unknown description is not sent; an empty role title clears it", async () => {
    const w = world();
    w.adminDb.returns("update_handover_details", "2026-11-12T10:00:01.000Z");
    const input = detailsInput(w.ids.handover, { title: `Treasurer handover, call ${PLANTED.phone}`, teamName: "Robotics Club", roleTitle: "" }, SEEN);
    assert.equal("description" in input, false, "an editor that never saw the description must not erase it");
    const result = await updateHandoverDetails(input);
    assert.ok(result.ok, JSON.stringify(result));
    const args = w.adminDb.last("update_handover_details")?.args ?? {};
    assertNoLeaks(args, "update_handover_details arguments");
    assert.match(String(args.p_title), /\[PHONE_1\]/);
    assert.equal(args.p_description, null, "description omitted → NULL → kept by the database");
    assert.equal(args.p_role_title, "", "empty role title is sent so the database clears it");
    assert.equal(args.p_expected_updated_at, SEEN);
  });

  it("a stale token (another tab saved first) is classified stale, with a content-free message", async () => {
    const w = world();
    w.adminDb.fails("update_handover_details", "BTCF0");
    const result = await updateHandoverDetails(detailsInput(w.ids.handover, { title: "Robotics handover", teamName: "Robotics", roleTitle: "" }, SEEN));
    assert.ok(!result.ok);
    assert.deepEqual(classifySaveError(result.error), { kind: "stale" });
    assert.doesNotMatch(result.error.message, /Robotics/);
  });

  it("a handover that is no longer a draft is classified not_draft (continue on its processing page)", async () => {
    const w = world();
    w.adminDb.fails("update_handover_details", "BTIT0");
    const result = await updateHandoverDetails(detailsInput(w.ids.handover, { title: "Robotics handover", teamName: "Robotics", roleTitle: "" }, SEEN));
    assert.ok(!result.ok);
    assert.deepEqual(classifySaveError(result.error), { kind: "not_draft" });
  });

  for (const [state, code] of [["BTNF0", "not_found"], ["BTFB0", "forbidden"]] as const) {
    it(`${code} is a plain failure, never retried, without content`, async () => {
      const w = world();
      w.adminDb.fails("update_handover_details", state);
      const result = await updateHandoverDetails(detailsInput(w.ids.handover, { title: "Robotics handover", teamName: "Robotics", roleTitle: "" }, SEEN));
      assert.ok(!result.ok);
      assert.equal(result.error.code, code);
      const c = classifySaveError(result.error);
      assert.equal(c.kind, "fail");
      assert.doesNotMatch(JSON.stringify(result), /Robotics/);
    });
  }

  it("invalid fields come back as field errors before any database call", async () => {
    const w = world();
    const result = await updateHandoverDetails(detailsInput(w.ids.handover, { title: "ab", teamName: "R", roleTitle: "" }, SEEN));
    assert.ok(!result.ok);
    const c = classifySaveError(result.error);
    assert.equal(c.kind, "fields");
    assert.ok(c.kind === "fields" && "title" in c.fieldErrors && "teamName" in c.fieldErrors, JSON.stringify(c));
    assert.deepEqual(w.adminDb.fns(), [], "nothing reached the database");
  });

  it("sameDetails treats an unknown description as equal to none (no phantom saves)", () => {
    const a = { title: "T", teamName: "Team", roleTitle: "" };
    assert.ok(sameDetails(a, { ...a }));
    assert.ok(!sameDetails(a, { ...a, roleTitle: "Treasurer" }));
    assert.ok(sameDetails(a, { ...a, description: undefined }));
  });
});
