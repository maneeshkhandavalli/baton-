// R3 Task 06 (Main, browser QA finding): incoming and lead members were offered review-only tabs that only say
// "for reviewers". The tabs now follow the viewer's role; access is still enforced by pages and the database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handoverNav, visibleHandoverNav } from "@/config/handover-navigation";

const titles = (role: Parameters<typeof visibleHandoverNav>[0]) => visibleHandoverNav(role).map((i) => i.title);

describe("handover tabs by role", () => {
  it("review roles see every stage", () => {
    assert.deepEqual(titles("outgoing"), handoverNav.map((i) => i.title));
    assert.deepEqual(titles("reviewer"), handoverNav.map((i) => i.title));
  });

  it("incoming and lead members see only the publication", () => {
    assert.deepEqual(titles("incoming"), ["Published"]);
    assert.deepEqual(titles("lead"), ["Published"]);
  });

  it("an unknown role (not loaded) falls back to every tab", () => {
    assert.deepEqual(titles(null), handoverNav.map((i) => i.title));
  });

  it("the Changes stage is review-only", () => {
    assert.equal(handoverNav.find((i) => i.title === "Changes")?.reviewOnly, true);
  });
});
