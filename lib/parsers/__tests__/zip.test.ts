import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildZip } from "../../../fixtures/parser/builders";
import { fixtureBytes, input, fileError } from "../../../fixtures/parser/load";
import { parseSource } from "../parse-source";
import { crc32 } from "../zip/crc32";
import { openZip } from "../zip/read-zip";

const ANDROID = fixtureBytes("whatsapp/android-24h-dmy.txt");
const IOS = fixtureBytes("whatsapp/ios-12h-dmy.txt");

async function parseZip(bytes: Uint8Array) {
  return parseSource(input({ kind: "whatsapp_export", bytes, fileName: "export.zip" }));
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });
});

describe("WhatsApp ZIP exports", () => {
  it("iOS: reads _chat.txt and ignores attachments", async () => {
    const zip = buildZip([
      { name: "_chat.txt", data: IOS },
      { name: "00000012-PHOTO-2024-01-15-10-02-00.jpg", data: new Uint8Array([0xff, 0xd8, 0xff]) },
    ]);
    const r = await parseZip(zip);
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
    assert.equal(r.data.messages.length, 10);
  });
  it("Android: reads the single .txt file", async () => {
    const zip = buildZip([
      { name: "WhatsApp Chat with Robotics Club Core.txt", data: ANDROID },
      { name: "IMG-20231231-WA0001.jpg", data: new Uint8Array(64) },
    ]);
    const r = await parseZip(zip);
    assert.ok(r.ok);
    assert.equal(r.data.messages.length, 13);
  });
  it("same result as the plain .txt export", async () => {
    const fromZip = await parseZip(buildZip([{ name: "chat.txt", data: ANDROID, method: "store" }]));
    const fromTxt = await parseSource(input({ kind: "whatsapp_export", bytes: ANDROID }));
    assert.ok(fromZip.ok && fromTxt.ok);
    assert.deepEqual(fromZip.data, fromTxt.data);
  });
  it("ignores __MACOSX metadata and directories", async () => {
    const zip = buildZip([
      { name: "export/", data: "" },
      { name: "__MACOSX/export/._chat.txt", data: "junk" },
      { name: "export/_chat.txt", data: IOS },
    ]);
    const r = await parseZip(zip);
    assert.ok(r.ok);
  });
  it("attachments are never decompressed (a corrupt attachment does not matter)", async () => {
    const zip = buildZip([
      { name: "_chat.txt", data: IOS },
      { name: "VID-0001.mp4", data: new Uint8Array(32), badCrc: true },
    ]);
    assert.ok((await parseZip(zip)).ok);
  });
});

describe("ZIP failure behaviour", () => {
  const cases: Array<{ name: string; zip: () => Uint8Array; parserCode: string }> = [
    { name: "no text file", zip: () => buildZip([{ name: "a.jpg", data: "x" }]), parserCode: "unsupported_format" },
    {
      name: "several text files",
      zip: () => buildZip([{ name: "a.txt", data: ANDROID }, { name: "b.txt", data: ANDROID }]),
      parserCode: "unsupported_format",
    },
    { name: "encrypted entry", zip: () => buildZip([{ name: "_chat.txt", data: IOS, encryptedFlag: true }]), parserCode: "password_protected" },
    { name: "bad CRC", zip: () => buildZip([{ name: "_chat.txt", data: IOS, badCrc: true }]), parserCode: "corrupt_file" },
    {
      name: "declared size smaller than the data (lying header)",
      zip: () => buildZip([{ name: "_chat.txt", data: IOS, declaredSize: 10 }]),
      parserCode: "too_large",
    },
    {
      name: "zip bomb (extreme compression ratio)",
      zip: () => buildZip([{ name: "_chat.txt", data: new Uint8Array(5 * 1024 * 1024) }]),
      parserCode: "too_large",
    },
    { name: "truncated archive", zip: () => buildZip([{ name: "_chat.txt", data: IOS }]).subarray(0, 40), parserCode: "corrupt_file" },
    { name: "empty chat file", zip: () => buildZip([{ name: "_chat.txt", data: "" }]), parserCode: "empty_source" },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const r = await parseZip(c.zip());
      assert.ok(!r.ok, "expected failure");
      assert.equal(fileError(r).details.parserCode, c.parserCode, r.error.message);
    });
  }
  it("rejects too many entries", () => {
    const entries = Array.from({ length: 20_001 }, (_, i) => ({ name: `f${i}`, data: "", method: "store" as const }));
    assert.throws(() => openZip(buildZip(entries)), (e: { error?: { details: { parserCode: string } } }) => e.error?.details.parserCode === "too_large");
  });
});
