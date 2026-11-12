// Round 3 (F1 QA-L5, F3 privacy): masked text is all that ever becomes evidence, and excluded people never
// reach evidence. Real lib/parsers + lib/privacy + lib/ai (extractCandidates on the deterministic fake
// adapter, whose default rules quote one verbatim sentence per keyword hit), synthetic data only.
//
// QA-L5 (open at baseline 24320e1, owner Agent 4 / E0): credentials written with a WHITESPACE separator
// ("password Hunter2", "pin 4821", "otp 556677", "login … / secret") are not masked. Those checks run as
// PENDING: a failing check marks the test TODO (reported, not red); a passing one prints
// "NOW HOLDS QA-L5" so it can be flipped to a hard assertion (replace pendingUntilFixed with a direct call).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, type TestContext } from "node:test";

import { extractCandidates } from "../../lib/ai/extract";
import type { AiStageOptions, ExtractRequest } from "../../lib/ai/provider";
import { createFakeProvider, fakeRunConfig } from "../../lib/ai/providers/fake";
import { POINT_CATEGORIES } from "../../lib/contracts/enums";
import type { ParsedSource } from "../../lib/contracts/parser";
import { parseSource, previewSource } from "../../lib/parsers/parse-source";
import { createMasker, maskText } from "../../lib/privacy/mask";
import { input, participantRule } from "../../fixtures/parser/load";
import { assertAbsent, assertNoLeaks } from "./support/sentinels";

/** Runs a check that is expected to fail until `finding` is fixed: failure → TODO, success → "NOW HOLDS". */
function pendingUntilFixed(t: TestContext, finding: string, check: () => void): void {
  try {
    check();
    t.diagnostic(`NOW HOLDS ${finding}: make this a hard assertion (tests/integration/r3-privacy-evidence.test.ts)`);
  } catch (error) {
    const first = error instanceof Error ? error.message.split("\n")[0] : String(error);
    t.todo(`open ${finding}: ${first}`);
  }
}

// ── QA-L5: the credential forms named in the Round 3 plan (E0), each with the secret that must vanish ──
const L5_FORMS: ReadonlyArray<{ text: string; secret: string }> = [
  { text: "the lab wifi password Hunter2 for now", secret: "Hunter2" },
  { text: "Password Hunter2", secret: "Hunter2" },
  { text: "door pin 4821 opens the store", secret: "4821" },
  { text: "PIN 4821", secret: "4821" },
  { text: "bank otp 556677 came just now", secret: "556677" },
  { text: "OTP 556677", secret: "556677" },
  { text: "passcode 9912 for the locker", secret: "9912" },
  { text: "pwd Tr3asurer!", secret: "Tr3asurer!" },
  { text: "portal login robotics_admin / Hunter2", secret: "Hunter2" },
  { text: "login: robotics_admin / S3cret#9", secret: "S3cret#9" },
  { text: "username robotics_admin password Hunter2", secret: "Hunter2" },
  { text: 'pwd "Tr3asurer!"', secret: "Tr3asurer!" }, // quoted value, whitespace separator
];

// Forms that are masked at baseline: regressions here are hard failures.
const MASKED_TODAY: ReadonlyArray<{ text: string; secret: string }> = [
  { text: "wifi password: Robo@2024!", secret: "Robo@2024!" },
  { text: "the door pin is 4321", secret: "4321" },
  { text: "passcode = 7788 for the cupboard", secret: "7788" },
];

describe("QA-L5: credentials with whitespace separators are masked (pending until E0 lands)", () => {
  for (const { text, secret } of MASKED_TODAY) {
    it(`control (hard): ${JSON.stringify(text)}`, () => {
      const out = maskText({ text }).text;
      assert.ok(!out.includes(secret), `${secret} survived masking: ${out}`);
    });
  }
  for (const { text, secret } of L5_FORMS) {
    it(`maskText: ${JSON.stringify(text)}`, (t) => {
      const out = maskText({ text }).text;
      pendingUntilFixed(t, "QA-L5", () => assert.ok(!out.includes(secret), `${secret} survived masking: ${out}`));
    });
  }
  it("createMasker (per-source) behaves like maskText for every L5 form", (t) => {
    const masker = createMasker();
    const outs = L5_FORMS.map(({ text }) => masker.mask(text).text);
    pendingUntilFixed(t, "QA-L5", () =>
      L5_FORMS.forEach(({ secret }, i) => assert.ok(!outs[i].includes(secret), `${secret} survived: ${outs[i]}`)),
    );
  });
  it("over-masking stays bounded: ordinary sentences keep their words (§12.1 errs to over-mask, not to erase)", () => {
    for (const text of ["We decided to pass the budget on Friday", "The pin badge order is pending", "Login page redesign is next step"]) {
      const out = maskText({ text }).text;
      assert.ok(out.split(/\s+/).length >= text.split(/\s+/).length - 2, `too much removed: ${out}`);
    }
  });
});

// ── End to end: chat → parse (exclusions + masking) → fake extraction → evidence quotes ──
const EXCLUDED = "Kiran Excluded";
const MARKER = "KIRANONLYMARKER";

function chatBytes(): Uint8Array {
  const lines = [
    "10/02/2024, 18:00 - Asha Rao: We decided the lab wifi password Hunter2 stays until March",
    "10/02/2024, 18:01 - Ravi Kumar: Ravi is responsible for the door pin 4821 and the store keys",
    "10/02/2024, 18:02 - Asha Rao: We decided the bank otp 556677 goes to the treasurer phone only",
    "10/02/2024, 18:03 - Ravi Kumar: Asha handles the portal login robotics_admin / Hunter2 for sponsors",
    "10/02/2024, 18:04 - Asha Rao: We decided the old wifi password: Robo@2024! is retired",
    "10/02/2024, 18:05 - Ravi Kumar: Ravi handles reimbursements, call +91 99999 00007 if stuck",
    `10/02/2024, 18:06 - ${EXCLUDED}: We decided ${MARKER} owns the sponsor list`,
    `10/02/2024, 18:07 - ${EXCLUDED}: Kiran is responsible for ${MARKER} budget sheets`,
    "10/02/2024, 18:08 - Asha Rao: We agreed Ravi handles the next step by Friday",
  ];
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

async function parsedChat(): Promise<ParsedSource> {
  const r = await parseSource(
    input({ kind: "whatsapp_export", bytes: chatBytes(), fileName: "chat.txt", dateOrder: "dmy", exclusions: [participantRule(EXCLUDED)] }),
  );
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
  return r.data;
}

function requestFrom(parsed: ParsedSource): ExtractRequest {
  const labels = new Map(parsed.participants.map((p) => [p.localId, p.displayLabel]));
  return {
    handover: { teamName: "Synthetic Robotics Club", roleTitle: "Treasurer" },
    categories: POINT_CATEGORIES,
    messages: parsed.messages
      .filter((m) => m.kind === "text" || m.kind === "document_block")
      .map((m) => ({ id: randomUUID(), authorLabel: m.participantLocalId ? (labels.get(m.participantLocalId) ?? null) : null, sentAt: m.sentAt, body: m.body })),
  };
}

const OPTS: AiStageOptions = { attempt: 1, runConfig: fakeRunConfig() };

describe("privacy chain: masked text is all that becomes evidence; excluded people never do", () => {
  it("the excluded participant is absent from the parse, the preview, the AI request and every evidence quote", async () => {
    const parsed = await parsedChat();
    assert.ok(!parsed.participants.some((p) => p.displayLabel.includes("Kiran")), "excluded participant not listed");
    const preview = await previewSource(
      input({ kind: "whatsapp_export", bytes: chatBytes(), fileName: "chat.txt", dateOrder: "dmy", exclusions: [participantRule(EXCLUDED)] }),
    );
    assert.ok(preview.ok);
    const req = requestFrom(parsed);
    const out = await extractCandidates(createFakeProvider(), req, OPTS);
    assert.ok(out.ok, JSON.stringify(!out.ok && out.error));
    assert.ok(out.data.candidates.length >= 3, "the keyword rules produced evidence-bearing candidates");
    assertAbsent({ parsed, preview: preview.data, req, candidates: out.data.candidates }, "excluded participant", [MARKER, EXCLUDED, "Kiran"]);
  });

  it("evidence quotes never carry the masked-today secrets or contact details (hard)", async () => {
    const parsed = await parsedChat();
    const out = await extractCandidates(createFakeProvider(), requestFrom(parsed), OPTS);
    assert.ok(out.ok);
    const quotes = out.data.candidates.flatMap((c) => c.citations.map((x) => x.quote));
    assert.ok(quotes.length >= 3);
    assertAbsent({ quotes, candidates: out.data.candidates }, "evidence", ["Robo@2024!", "99999 00007", "+91 99999 00007"]);
    assertNoLeaks({ quotes }, "evidence quotes (generic PII patterns)");
  });

  it("evidence quotes never carry whitespace-separated credentials (QA-L5, pending)", async (t) => {
    const parsed = await parsedChat();
    const out = await extractCandidates(createFakeProvider(), requestFrom(parsed), OPTS);
    assert.ok(out.ok);
    const persisted = parsed.messages.map((m) => m.body);
    const quotes = out.data.candidates.flatMap((c) => c.citations.map((x) => x.quote));
    pendingUntilFixed(t, "QA-L5", () =>
      assertAbsent({ persisted, quotes }, "persisted bodies and evidence quotes", ["Hunter2", "4821", "556677"]),
    );
  });
});
