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

  it("incoming and lead members see only the publication (and its timeline)", () => {
    assert.deepEqual(titles("incoming"), ["Published", "Timeline"]);
    assert.deepEqual(titles("lead"), ["Published", "Timeline"]);
  });

  it("the Timeline tab follows Published and is open to every member", () => {
    const i = handoverNav.findIndex((n) => n.title === "Timeline");
    assert.equal(handoverNav[i - 1]?.title, "Published");
    assert.equal(handoverNav[i].reviewOnly, false);
    assert.equal(handoverNav[i].href("h1"), "/handover/h1/timeline");
  });

  it("an unknown role (not loaded) falls back to every tab", () => {
    assert.deepEqual(titles(null), handoverNav.map((i) => i.title));
  });

  it("the Changes stage is review-only", () => {
    assert.equal(handoverNav.find((i) => i.title === "Changes")?.reviewOnly, true);
  });
});
