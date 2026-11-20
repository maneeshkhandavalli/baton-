// Review Edit dialog: fields pre-fill with the text the card shows (names this viewer may see, else
// "Person n"), never the raw [PERSON_n] placeholder, and saving without retyping sends the stored values back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { resolvePersonTokens } from "../../shared/mask-tokens";
import { editDraftFor, editedValues, retokenizePeople } from "../edit-draft";

const NAMES: ReadonlyMap<number, string> = new Map([[1, "Meera"]]);
const point = {
  title: "Owner: [PERSON_1] handles the volunteer roster",
  statement: "[PERSON_1] handles the volunteer roster and owns the shift plan. Call [PHONE_1].",
  attributes: {
    responsibility: "[PERSON_1] handles the volunteer roster and owns the shift plan.",
    nameLabel: "[PERSON_1]",
    backup: null,
    systems: ["Roster sheet of [PERSON_2]", "Shift plan"],
  },
} as unknown as Parameters<typeof editDraftFor>[0];

describe("resolvePersonTokens", () => {
  it("names a person the viewer may see, says Person n otherwise, and keeps masks and exclusions as written", () => {
    assert.equal(
      resolvePersonTokens("[PERSON_1] and [PERSON_2] or [PERSON]; [PHONE_1] [EXCLUDED_PARTICIPANT]", NAMES),
      "Meera and Person 2 or a participant; [PHONE_1] [EXCLUDED_PARTICIPANT]",
    );
  });
});

describe("edit dialog draft", () => {
  it("pre-fills title, statement and every text or list attribute with the shown names", () => {
    const draft = editDraftFor(point, NAMES);
    assert.equal(draft.title, "Owner: Meera handles the volunteer roster");
    assert.equal(draft.statement, "Meera handles the volunteer roster and owns the shift plan. Call [PHONE_1].");
    assert.equal(draft.attributes.responsibility, "Meera handles the volunteer roster and owns the shift plan.");
    assert.equal(draft.attributes.nameLabel, "Meera");
    assert.equal(draft.attributes.backup, null);
    assert.deepEqual(draft.attributes.systems, ["Roster sheet of Person 2", "Shift plan"]);
    assert.doesNotMatch(JSON.stringify(draft), /\[PERSON/);
  });

  it("without names (no clearance or no provider) shows Person n, like the card", () => {
    const draft = editDraftFor(point, new Map());
    assert.equal(draft.attributes.nameLabel, "Person 1");
    assert.doesNotMatch(JSON.stringify(draft), /\[PERSON/);
  });

  it("saving untouched fields sends the stored values back, not the shown names", () => {
    const initial = editDraftFor(point, NAMES);
    const saved = editedValues(point, initial, { ...initial, attributes: { ...initial.attributes } }, NAMES);
    assert.equal(saved.title, point.title);
    assert.equal(saved.statement, point.statement);
    assert.deepEqual(saved.attributes, point.attributes);
  });

  it("only the fields the reviewer changed carry what was typed", () => {
    const initial = editDraftFor(point, NAMES);
    const saved = editedValues(point, initial, {
      title: "  Owner: Meera runs the roster ",
      statement: `${initial.statement} `, // whitespace only: unchanged
      attributes: { ...initial.attributes, backup: "Ravi", systems: ["Roster sheet of Person 2", "Shift plan"] },
    }, NAMES);
    assert.equal(saved.title, "Owner: [PERSON_1] runs the roster", "a shown name goes back to its placeholder");
    assert.equal(saved.statement, point.statement);
    const stored = point.attributes as Record<string, unknown>;
    assert.equal(saved.attributes.backup, "Ravi");
    assert.equal(saved.attributes.responsibility, stored.responsibility);
    assert.equal(saved.attributes.nameLabel, "[PERSON_1]");
    assert.deepEqual(saved.attributes.systems, stored.systems);
  });
  // Audit 21 Nov (blocker): a one-word fix next to a name stored the name in clear.
  it("a changed field keeps its placeholders: the shown name and Person n go back to [PERSON_n]", () => {
    const initial = editDraftFor(point, NAMES);
    const saved = editedValues(point, initial, { ...initial, statement: initial.statement.replace("owns", "now owns") }, NAMES);
    assert.equal(saved.statement, "[PERSON_1] handles the volunteer roster and now owns the shift plan. Call [PHONE_1].");
    assert.doesNotMatch(JSON.stringify(saved), /Meera/);
    const noNames = editDraftFor(point, new Map());
    const saved2 = editedValues(point, noNames, { ...noNames, title: noNames.title + " (weekends)" }, new Map());
    assert.equal(saved2.title, "Owner: [PERSON_1] handles the volunteer roster (weekends)");
  });

  it("retokenizePeople: whole words, any case, longest name first, existing tokens untouched", () => {
    const names = new Map([[1, "Meera"], [2, "Meera Iyer"], [3, "Ravi"]]);
    assert.equal(
      retokenizePeople("meera and Meera Iyer met RAVI; Meeraj stays; [PERSON_3] too", names),
      "[PERSON_1] and [PERSON_2] met [PERSON_3]; Meeraj stays; [PERSON_3] too",
    );
    assert.equal(retokenizePeople("Person 4 called person 12.", new Map()), "[PERSON_4] called [PERSON_12].");
    assert.equal(retokenizePeople("A (b) [c]? name", new Map([[5, "A (b) [c]?"]])), "[PERSON_5] name", "regex characters in a name are escaped");
  });
});

describe("edit dialog wiring (static: test:ui cannot transpile .tsx)", () => {
  it("pre-fills from the viewer's names and saves through editedValues", () => {
    const dialog = readFileSync(join(process.cwd(), "components/review/review-dialogs.tsx"), "utf8");
    assert.match(dialog, /const names = usePeopleNames\(\);/);
    assert.match(dialog, /useState\(\(\) => editDraftFor\(point, names\)\)/);
    assert.match(dialog, /\.\.\.editedValues\(point, initial, \{ title, statement, attributes \}, names\)/);
    assert.doesNotMatch(dialog, /useState\(point\.(title|statement)\)/);
  });
});
