// The synthetic chat used by the opt-in live Gemini end-to-end test (tests/live/gemini-e2e.live.test.ts):
// fixtures/demo/round2-gemini-e2e.txt. Offline check that it parses with the real WhatsApp parser, has the
// expected shape, and that its two planted PII values never reach a persisted body.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { input } from "../../../fixtures/parser/load";
import type { ParsedSource } from "../../contracts/parser";
import { parseSource } from "../parse-source";

const FIXTURE = new URL("../../../fixtures/demo/round2-gemini-e2e.txt", import.meta.url);
const PLANTED = ["99999 00002", "treasurer@example.org"];

async function parsed(extra: Partial<Parameters<typeof input>[0]> = {}): Promise<ParsedSource> {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const r = await parseSource(input({ kind: "whatsapp_export", bytes, fileName: "round2-gemini-e2e.txt", ...extra }));
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

describe("round2 Gemini e2e fixture", () => {
  it("has 20-30 lines in the Android 24h day-first format", () => {
    const lines = readFileSync(FIXTURE, "utf8").split("\n").filter((l) => l.length > 0);
    assert.ok(lines.length >= 20 && lines.length <= 30, `${lines.length} lines`);
    for (const l of lines) assert.match(l, /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} - /);
    for (const p of PLANTED) assert.equal(lines.filter((l) => l.includes(p)).length, 1, `planted ${p} once`);
  });

  it("parses every line as one message, detecting day-first dates", async () => {
    const s = await parsed();
    assert.equal(s.kind, "whatsapp_export");
    assert.equal(s.messages.length, 23);
    assert.equal(s.messages.filter((m) => m.kind === "system").length, 4);
    assert.equal(s.messages.filter((m) => m.kind === "media_omitted").length, 1);
    assert.equal(s.messages.filter((m) => m.kind === "text").length, 18);
    // 13/11/2026 18:00 IST = 12:30 UTC; 14/11/2026 09:52 IST = 04:22 UTC
    assert.equal(s.firstMessageAt, "2026-11-13T12:30:00.000Z");
    assert.equal(s.lastMessageAt, "2026-11-14T04:22:00.000Z");
    // The live test supplies dateOrder "dmy" explicitly; it must agree with detection.
    const dmy = await parsed({ dateOrder: "dmy" });
    assert.deepEqual(dmy.messages.map((m) => m.sentAt), s.messages.map((m) => m.sentAt));
  });

  it("has three distinct named participants", async () => {
    const s = await parsed();
    assert.deepEqual(s.participants.map((p) => p.displayLabel).sort(), ["Asha Rao", "Meera Iyer", "Ravi Kumar"]);
    assert.equal(new Set(s.participants.map((p) => p.identityHash)).size, 3);
    assert.equal(s.conversations.length, 2); // overnight gap > 6 hours
  });

  it("masks the planted phone and email in persisted bodies, and nowhere else leaks them", async () => {
    const s = await parsed();
    for (const p of PLANTED) {
      assert.ok(!s.messages.some((m) => m.body.includes(p)), `${p} persisted unmasked`);
      assert.ok(!JSON.stringify(s).includes(p), `${p} leaked into the parsed output`);
    }
    assert.ok(s.messages.some((m) => /\[PHONE_\d+\]/.test(m.body)), "phone mask token");
    assert.ok(s.messages.some((m) => /\[EMAIL_\d+\]/.test(m.body)), "email mask token");
    assert.equal(s.masking.counts.phone, 1);
    assert.equal(s.masking.counts.email, 1);
    const total = Object.values(s.masking.counts).reduce((a, n) => a + n, 0);
    assert.equal(total, 2, "nothing but the two planted values is masked (dates and names stay quotable)");
  });

  it("keeps the deadline dates and owner names verbatim (the live attribute check depends on them)", async () => {
    const all = (await parsed()).messages.map((m) => m.body).join("\n");
    for (const kept of ["20 November 2026", "25 November 2026", "28/11/2026", "Ravi Kumar will submit", "Meera Iyer will send", "Asha Rao will hand over"]) {
      assert.ok(all.includes(kept), kept);
    }
  });
});
