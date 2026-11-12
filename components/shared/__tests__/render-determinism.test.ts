// Server and client must render the same markup (no hydration mismatches), and Cache Components
// pages must not read the clock while prerendering. Covers the fixes for the three preview runtime
// errors found by the browser harness (dashboard, wizard, published).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { formatDate, formatDateRange, formatDateTime, formatShortDate } from "../../handover/format";
import { buildFirstWeek, firstWeekStorageKey, parseTicks } from "../../published/first-week";
import type { PublishedHandover } from "../../../lib/contracts/dto";
import { formatDayOrRaw } from "../key-facts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("date formatting is identical on every runtime", () => {
  it("uses fixed month names, not the ICU build's (\"Sep\", never \"Sept\")", () => {
    assert.equal(formatDate("2026-09-20"), "20 Sep 2026");
    assert.equal(formatShortDate("2026-09-02T11:00:00.000Z"), "2 Sep");
    assert.equal(formatDayOrRaw("2026-09-02"), "2 Sep 2026");
  });

  it("formats in India time whatever the host time zone is", () => {
    // 18:45Z is 00:15 the next day in Asia/Kolkata.
    assert.equal(formatDateTime("2026-09-20T18:45:00.000Z"), "21 Sep 2026, 00:15");
    assert.equal(formatDate("2026-11-30T20:00:00.000Z"), "1 Dec 2026");
    assert.equal(formatDateTime("2026-01-05T06:30:00.000Z"), "5 Jan 2026, 12:00");
  });

  it("midnight is 00, never 24", () => {
    assert.equal(formatDateTime("2026-03-01T18:30:00.000Z"), "2 Mar 2026, 00:00");
  });

  it("keeps the empty and invalid fallbacks", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDateTime(undefined), "—");
    assert.equal(formatDate("not a date"), "not a date");
    assert.equal(formatDateRange("2026-03-01T04:00:00.000Z", "2026-09-28T12:00:00.000Z"), "1 Mar – 28 Sep 2026");
  });
});

describe("first-week ticks read from browser storage", () => {
  it("keys ticks per publication", () => {
    assert.equal(firstWeekStorageKey("p1"), "baton:first-week:p1");
  });

  it("treats missing, malformed or wrong-shaped storage as nothing ticked (the server's render)", () => {
    assert.deepEqual(parseTicks(null), []);
    assert.deepEqual(parseTicks(""), []);
    assert.deepEqual(parseTicks("{not json"), []);
    assert.deepEqual(parseTicks('{"a":1}'), []);
    assert.deepEqual(parseTicks('["a:access", 3, null, "b:task"]'), ["a:access", "b:task"]);
  });

  it("the published view reads ticks through useSyncExternalStore with a server snapshot", () => {
    const src = read("components/published/published-handover-view.tsx");
    assert.match(src, /useSyncExternalStore\(subscribeStorage, \(\) => readStorage\(key\), \(\) => null\)/);
    // No storage read during render outside the store.
    assert.equal(src.match(/localStorage\.getItem/g)?.length, 1);
  });
});

describe("first-week due dates (QA-R3-12-R1)", () => {
  const detail = (dueDate: unknown) =>
    buildFirstWeek({
      sections: [{ category: "open_task", points: [{ id: "p1", content: { title: "Renew domain", statement: "", attributes: { dueDate, assigneeLabel: "Ravi" }, isKnownGap: false } }] }],
    } as unknown as PublishedHandover).flatMap((d) => d.items)[0];

  it("formats a real day and shows anything else as written, never rolled over or guessed", () => {
    assert.equal(detail("2026-11-30")?.detail, "Due 30 Nov 2026");
    assert.equal(detail("2026-02-30")?.detail, "Due 2026-02-30");
    assert.equal(detail("March 5")?.detail, "Due March 5");
    assert.equal(detail("1")?.detail, "Due 1");
  });

  it("a blank due date reads as undated", () => {
    assert.doesNotMatch(String(detail("   ")?.detail ?? ""), /^Due/);
  });
});

describe("dashboard draft rows", () => {
  it("DraftRow lives in its own module and both dashboards import it from there", () => {
    assert.match(read("components/dashboard/draft-row.tsx"), /export function DraftRow\(/);
    for (const page of ["app/(workspace)/dashboard/page.tsx", "app/(preview)/preview/dashboard/page.tsx"]) {
      const src = read(page);
      assert.match(src, /import \{ DraftRow \} from "@\/components\/dashboard\/draft-row";/, page);
      assert.doesNotMatch(src, /DraftRow[^;]*from "@\/components\/dashboard\/handover-card"/, page);
    }
    // handover-card only re-exports it (no second definition, no direct client-component import).
    const card = read("components/dashboard/handover-card.tsx");
    assert.doesNotMatch(card, /function DraftRow|discard-draft-button/);
    assert.ok(card.includes('export { DraftRow } from "./draft-row";'));
  });
});

describe("wizard preview under Cache Components", () => {
  it("awaits connection() before reading the clock", () => {
    const src = read("app/(preview)/preview/wizard/page.tsx");
    const body = src.slice(src.indexOf("async function Content"));
    const conn = body.indexOf("await connection();");
    const clock = body.indexOf("minutesAgo(");
    assert.ok(conn !== -1, "Content must await connection()");
    assert.ok(clock === -1 || conn < clock, "connection() must come before the clock read");
    assert.ok(conn < body.indexOf("await searchParams"), "connection() comes first");
  });
});
