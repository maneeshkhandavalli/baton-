// Round 3 B2: the synthetic conflict fixture (tests/fixtures/round3-conflict/) really produces a
// `contradicts` relation with the deterministic FAKE adapter, through the same pieces the pipeline uses:
// real parse + masking (lib/parsers, lib/privacy) → real extractCandidates on the fake adapter → the real
// serial dedup (lib/pipeline/dedup PointIndex, as stages/extract.ts uses it) → real verifySupport.
//
// Why it works with the fake adapter (see README.md): an `owner` candidate's subject key is its
// `responsibility` = the first 200 characters of the quoted sentence. Both sources share an identical
// 220-character opening, so the second source's candidate attaches to the first one's point (same subject);
// the fake verifier marks the attached quote `contradicts` (high word overlap, opposite negation: "no longer")
// and the point's own quote `supports` (either extraction order). The DB then makes the point `conflicting`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { extractCandidates, type CheckedCandidate } from "../../lib/ai/extract";
import type { AiStageOptions, ExtractRequest } from "../../lib/ai/provider";
import { createFakeProvider, fakeRunConfig } from "../../lib/ai/providers/fake";
import { verifySupport } from "../../lib/ai/verify-support";
import { POINT_CATEGORIES } from "../../lib/contracts/enums";
import type { ParsedSource, ParseSourceInput } from "../../lib/contracts/parser";
import { parseSource } from "../../lib/parsers/parse-source";
import { PointIndex } from "../../lib/pipeline/dedup";
import { input } from "../../fixtures/parser/load";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "round3-conflict");
const bytes = (f: string) => new Uint8Array(readFileSync(join(DIR, f)));
const OPTS: AiStageOptions = { attempt: 1, runConfig: fakeRunConfig() };

async function parse(over: Partial<ParseSourceInput> & Pick<ParseSourceInput, "kind" | "bytes">): Promise<ParsedSource> {
  const r = await parseSource(input({ dateOrder: "dmy", ...over }));
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
  return r.data;
}

function request(parsed: ParsedSource) {
  const labels = new Map(parsed.participants.map((p) => [p.localId, p.displayLabel]));
  const messages = parsed.messages
    .filter((m) => m.kind === "text" || m.kind === "document_block")
    .map((m) => ({ id: randomUUID(), authorLabel: m.participantLocalId ? (labels.get(m.participantLocalId) ?? null) : null, sentAt: m.sentAt, body: m.body }));
  const req: ExtractRequest = { handover: { teamName: "Synthetic Robotics Club", roleTitle: "Treasurer" }, categories: POINT_CATEGORIES, messages };
  return req;
}

async function candidates(req: ExtractRequest): Promise<CheckedCandidate[]> {
  const out = await extractCandidates(createFakeProvider(), req, OPTS);
  assert.ok(out.ok, JSON.stringify(!out.ok && out.error));
  return out.data.candidates;
}

describe("B2: round3-conflict fixture yields `contradicts` with the fake adapter", () => {
  for (const order of [["chat", "handbook"], ["handbook", "chat"]] as const) {
    it(`extracted ${order[0]} first: the other source's owner claim attaches and is judged contradicts`, async () => {
      const parsed = {
        chat: await parse({ kind: "whatsapp_export", bytes: bytes("chat.txt"), fileName: "chat.txt" }),
        handbook: await parse({ kind: "markdown", bytes: bytes("handbook.md"), fileName: "handbook.md" }),
      };
      // first source: every candidate becomes a point (extract jobs of a run run one at a time)
      const index = new PointIndex([], "everyone");
      const points = new Map<string, { claim: CheckedCandidate; quotes: string[] }>();
      for (const c of await candidates(request(parsed[order[0]]))) {
        assert.equal(index.find(c), null);
        const id = randomUUID();
        index.add(id, c);
        points.set(id, { claim: c, quotes: c.citations.map((x) => x.matchedText ?? x.quote) });
      }
      const banking = [...points.entries()].find(([, p]) => p.claim.category === "owner" && /bank signing mandate/.test(p.claim.statement));
      assert.ok(banking, "the banking sentence became an owner point");

      // second source: only the banking candidate attaches to that point (same owner subject)
      const attached: string[] = [];
      for (const c of await candidates(request(parsed[order[1]]))) {
        const target = index.find(c);
        if (target === null) continue;
        assert.equal(target, banking[0], `only the banking claim merges, got: ${c.statement}`);
        attached.push(...c.citations.map((x) => x.matchedText ?? x.quote));
      }
      assert.equal(attached.length, 1, "exactly one quote attached from the second source");
      assert.match(attached[0], /bank signing mandate/);

      const claim = banking[1].claim;
      const verdict = async (quote: string) => {
        const r = await verifySupport(createFakeProvider(), {
          claim: { category: claim.category, title: claim.title, statement: claim.statement, attributes: claim.attributes },
          quote: { text: quote, authorLabel: null, sentAt: null },
          context: [],
        }, OPTS);
        assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
        return r.data.verdict;
      };
      assert.equal(await verdict(banking[1].quotes[0]), "supports", "the point's own quote supports it");
      assert.equal(await verdict(attached[0]), "contradicts", "the other source's quote contradicts it");
    });
  }

  it("the fixture is synthetic and survives masking unchanged where it matters (no PII patterns, dates kept)", async () => {
    const handbook = await parse({ kind: "markdown", bytes: bytes("handbook.md"), fileName: "handbook.md" });
    const text = handbook.messages.map((m) => m.body).join("\n");
    assert.match(text, /due by 31 January/);
    assert.doesNotMatch(text, /\[(PHONE|EMAIL|UPI|BANK|CARD|ID)_\d+\]/, "nothing in the fixture looks like PII");
  });
});
