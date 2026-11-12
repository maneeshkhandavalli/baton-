// Round 3 (D4): the multi-format synthetic QA set in fixtures/demo/round3-multiformat. The committed files
// must be exactly what build.ts produces, and each must give the documented parser outcome.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MULTIFORMAT_SET } from "../../../fixtures/demo/round3-multiformat/build";
import { fileError, input } from "../../../fixtures/parser/load";
import { checkSourceUploadRequest, SOURCE_KIND_EXTENSIONS } from "../../db/storage";
import { parseSource, previewSource } from "../parse-source";

const committed = (file: string) => new Uint8Array(readFileSync(new URL(`../../../fixtures/demo/round3-multiformat/${file}`, import.meta.url)));

/** The fake adapter's keyword families (lib/ai/providers/fake.ts RULES), mirrored for this sanity check. */
const FAKE_EXTRACT_KEYWORDS =
  /\b(decided|agreed|we will go with|finali[sz]ed|in charge of|responsible for|handles|owns|blocked|stuck|waiting on|risk|might fail|could fail|again|every time|keeps happening|next step|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)|todo|to do|need to|needs to|pending)\b/i;

describe("R3 D4: multi-format synthetic QA set", () => {
  it("covers TXT, ZIP, Markdown, PDF and DOCX, plus two documented failure cases", () => {
    const exts = new Set(MULTIFORMAT_SET.map((f) => f.file.split(".").pop()));
    for (const e of ["txt", "zip", "md", "pdf", "docx"]) assert.ok(exts.has(e), e);
    assert.ok(MULTIFORMAT_SET.filter((f) => !f.expect.ok).length >= 2);
  });

  it("every file has a distinct SHA-256 (no duplicate-upload conflict within the set)", () => {
    const hashes = MULTIFORMAT_SET.map((f) => createHash("sha256").update(committed(f.file)).digest("hex"));
    assert.equal(new Set(hashes).size, hashes.length);
  });

  for (const f of MULTIFORMAT_SET) {
    describe(f.file, () => {
      it("committed bytes equal the deterministic build", () => {
        assert.deepEqual(committed(f.file), f.bytes());
      });

      it("passes the upload request checks for its kind", () => {
        const ext = f.file.split(".").pop()!;
        assert.ok(SOURCE_KIND_EXTENSIONS[f.kind].includes(ext));
        const bytes = committed(f.file);
        assert.doesNotThrow(() =>
          checkSourceUploadRequest({
            handoverId: "11111111-1111-4111-8111-111111111111",
            kind: f.kind,
            fileName: f.file,
            mimeType: "",
            sizeBytes: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          }),
        );
      });

      it(f.expect.ok ? "parses with the documented counts and masking" : `fails with ${f.expect.parserCode}`, async () => {
        const i = input({ kind: f.kind, bytes: committed(f.file), fileName: f.file });
        const r = await parseSource(i);
        const p = await previewSource(i);
        if (!f.expect.ok) {
          assert.equal(fileError(r).details.parserCode, f.expect.parserCode);
          assert.equal(fileError(p).details.parserCode, f.expect.parserCode);
          return;
        }
        assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
        assert.equal(r.data.messages.length, f.expect.messages);
        assert.equal(r.data.participants.length, f.expect.participants);
        for (const [k, n] of Object.entries(f.expect.masked)) assert.equal(r.data.masking.counts[k as keyof typeof r.data.masking.counts], n, k);
        assert.ok(r.data.messages.some((m) => FAKE_EXTRACT_KEYWORDS.test(m.body)), "gives the fake adapter something to extract");
        assert.deepEqual(r.data.warnings, []);
        assert.ok(p.ok);
      });
    });
  }

  it("the ambiguous-dates chat parses once the creator chooses day-first", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: committed("round3-ambiguous-dates-chat.txt"), dateOrder: "dmy" }));
    assert.ok(r.ok);
    assert.equal(r.data.messages.length, 3);
    assert.equal(r.data.messages[0].sentAt, "2026-03-02T04:30:00.000Z");
  });
});
