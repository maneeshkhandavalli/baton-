import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accountNav, workspaceNav } from "@/config/navigation";

import { isNavActive } from "../nav-match";

const current = (path: string | null) => [...workspaceNav, ...accountNav].filter((i) => isNavActive(path, i)).map((i) => i.title);

describe("workspace nav: current item", () => {
  it("marks exactly one item on each workspace page", () => {
    assert.deepEqual(current("/dashboard"), ["Dashboard"]);
    assert.deepEqual(current("/handover/new"), ["New handover"]);
    assert.deepEqual(current("/handover/abc/review"), ["Dashboard"]);
    assert.deepEqual(current("/handover/abc/published/"), ["Dashboard"]);
    assert.deepEqual(current("/account"), ["Account"]);
    assert.deepEqual(current("/account/password"), ["Account"]);
  });

  it("marks nothing when the path is unknown or not yet known", () => {
    assert.deepEqual(current("/somewhere"), []);
    assert.deepEqual(current("/dashboards"), []);
    assert.deepEqual(current(null), []);
  });
});
