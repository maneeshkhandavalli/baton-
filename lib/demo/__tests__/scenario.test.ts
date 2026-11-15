// DEMO scenario (lib/demo/scenario): the CodeCell story must be internally consistent and survive the
// REAL parser and masker. Every quote is word for word in the masked parse, with the right author, time
// and line; masking hides every planted contact detail; nothing is credential-like; the opted-out member
// and the excluded date range are gone; the timeline is ordered; the canonical path is valid.
//
// Run: node --import ./lib/mocks/__tests__/resolve-ui.mjs --test "lib/demo/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { input, participantRule } from "../../../fixtures/parser/load";
import type { ExclusionRule, NormalizedMessage, ParsedSource } from "../../contracts/parser";
import type { EvidenceStatus } from "../../contracts/enums";
import { createManualPointInput, parsePointAttributes } from "../../contracts/schemas";
import { parseSource } from "../../parsers/parse-source";
import { maskText } from "../../privacy/mask";
import {
  DEMO_CANONICAL_ACTIONS,
  DEMO_CAST,
  DEMO_EXCLUSIONS,
  DEMO_GAP_ANSWER,
  DEMO_GAP_QUESTIONS,
  DEMO_MENTIONED,
  DEMO_POINTS,
  DEMO_SOURCES,
  DEMO_TIMELINE,
  DEMO_TIMEZONE,
  OPTED_OUT_SENDER,
  lineOf,
  whatsappSentAt,
  type DemoEvidenceSeed,
  type DemoPointSeed,
  type DemoSourceKey,
} from "../scenario/index";

const bytes = (s: string) => new TextEncoder().encode(s);
const CREDENTIAL_TOKEN = /\[(PASSWORD|API_KEY|SECRET|CARD|BANK|IFSC|UPI|ID)(_\d+)?\]/;

function exclusionsFor(key: DemoSourceKey): ExclusionRule[] {
  if (key !== "core") return [];
  const { rangeStart, rangeEnd } = DEMO_EXCLUSIONS.tripPlanning;
  return [participantRule(OPTED_OUT_SENDER), { kind: "date_range", rangeStart, rangeEnd }];
}

const parsed = {} as Record<DemoSourceKey, ParsedSource>;

before(async () => {
  for (const s of Object.values(DEMO_SOURCES)) {
    const r = await parseSource(input({ kind: s.kind, bytes: bytes(s.raw), fileName: s.fileName, timezone: DEMO_TIMEZONE, exclusions: exclusionsFor(s.key) }));
    assert.ok(r.ok, `${s.key}: ${r.ok ? "" : JSON.stringify(r.error)}`);
    parsed[s.key] = r.data;
  }
});

/** Simplified §4.2 status for a seed (all evidence verified against revision 1, nothing excluded). */
function seedStatus(p: Pick<DemoPointSeed, "evidence" | "rationale">): EvidenceStatus {
  if (p.evidence.some((e) => e.verdict === "contradicts")) return "conflicting";
  if (p.evidence.some((e) => e.verdict === "supports")) return "sourced";
  if (p.evidence.some((e) => e.verdict === "partial" || e.verdict === "unchecked") || (p.rationale ?? "").trim()) return "inferred";
  return "missing";
}

function messageFor(e: DemoEvidenceSeed): NormalizedMessage {
  const src = DEMO_SOURCES[e.source];
  const ps = parsed[e.source];
  if (src.kind === "markdown") {
    assert.ok(e.block, `document evidence needs a block: ${e.quote}`);
    const m = ps.messages.find((x) => x.location?.lineStart === e.block!.lineStart);
    assert.ok(m, `no block at line ${e.block!.lineStart} in ${e.source}`);
    assert.equal(m.location?.lineEnd, e.block!.lineEnd, `block end for "${e.quote}"`);
    assert.equal(m.location?.heading, e.block!.heading, `heading for "${e.quote}"`);
    return m;
  }
  const line = lineOf(src.raw, e.find ?? e.quote);
  const m = ps.messages.find((x) => x.location?.lineStart === line);
  assert.ok(m, `line ${line} of ${e.source} was not kept by the parser ("${e.quote}")`);
  return m;
}

describe("demo scenario: sources through the real parser and masker", () => {
  it("parses every source with no warnings and the expected participants", () => {
    for (const ps of Object.values(parsed)) assert.deepEqual(ps.warnings, []);
    const names = (k: DemoSourceKey) => parsed[k].participants.map((p) => p.displayLabel).sort();
    assert.deepEqual(names("core"), ["Ananya Iyer", "Arjun Mehta", "Ishaan Rao", "Kabir Shah", "Neha Kulkarni", "Priya Raman", "Rohan Pillai"]);
    assert.deepEqual(names("leads"), ["Arjun Mehta", "Kabir Shah", "Priya Raman", "Rohan Pillai"]);
    for (const p of [...parsed.core.participants, ...parsed.leads.participants]) assert.equal(p.identityKind, "name", `${p.displayLabel} is a saved contact`);
  });

  it("masks every planted phone number and email address, and finds nothing credential-like", () => {
    const planted = [
      ...Object.values(DEMO_CAST).flatMap((c) => [c.phone, c.email]),
      DEMO_MENTIONED.desai.phone,
      DEMO_MENTIONED.farah.phone,
      DEMO_MENTIONED.farah.email,
      OPTED_OUT_SENDER,
      "99999 00007",
    ];
    for (const [key, ps] of Object.entries(parsed)) {
      const all = JSON.stringify(ps);
      for (const p of planted) assert.ok(!all.includes(p), `${p} must not survive parsing ${key}`);
      for (const kind of ["password", "api_key", "secret", "card", "bank_account", "ifsc", "upi", "government_id"] as const) {
        assert.equal(ps.masking.counts[kind], 0, `${key}: nothing may be masked as ${kind}`);
      }
      assert.doesNotMatch(all, CREDENTIAL_TOKEN);
    }
    assert.equal(parsed.core.masking.counts.phone, 2, "Mr. Desai's and Ishaan's numbers");
    assert.equal(parsed.leads.masking.counts.phone, 1, "Orbitstack's office line");
    assert.equal(parsed.leads.masking.counts.email, 1, "Farah's email");
  });

  it("drops the opted-out member and the trip-planning dates before anything is kept", () => {
    const body = parsed.core.messages.map((m) => m.body).join("\n");
    assert.ok(!body.includes("hdmi cable"), "the opted-out member's message is gone");
    for (const t of ["trip after diwali", "which dates", "2nd to 4th", "homestay"]) assert.ok(!body.includes(t), `"${t}" is in the excluded range`);
    assert.equal(parsed.core.participants.length, 7);
    assert.ok(parsed.core.stats.messagesExcluded >= 5);
  });

  it("keeps the timeline consistent: evidence-as-of is the last message, exports come after it", () => {
    const last = Object.values(parsed)
      .map((p) => p.lastMessageAt)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1);
    assert.equal(last, DEMO_TIMELINE.evidenceAsOf);
    const order = Object.entries(DEMO_TIMELINE).filter(([k]) => k !== "priyaLeavesOn" && k !== "evidenceAsOf");
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1][1] < order[i][1], `${order[i - 1][0]} before ${order[i][0]}`);
    assert.ok(DEMO_TIMELINE.evidenceAsOf < DEMO_TIMELINE.exportedAt);
    assert.ok(DEMO_TIMELINE.publishedV2At.slice(0, 10) < DEMO_TIMELINE.priyaLeavesOn);
  });
});

describe("demo scenario: points and evidence", () => {
  it("every quote is word for word in the masked parse, with the right author, time and location", () => {
    for (const p of DEMO_POINTS) {
      for (const e of p.evidence) {
        const m = messageFor(e);
        assert.ok(m.body.includes(e.quote), `#${p.n} quote not found word for word in the masked message:\n  quote: ${e.quote}\n  body:  ${m.body}`);
        const src = DEMO_SOURCES[e.source];
        if (src.kind === "whatsapp_export") {
          const author = parsed[e.source].participants.find((x) => x.localId === m.participantLocalId)?.displayLabel;
          assert.equal(author, e.by ? DEMO_CAST[e.by].displayName : undefined, `#${p.n} author of "${e.quote}"`);
          assert.equal(m.sentAt, whatsappSentAt(src.raw, m.location!.lineStart), `#${p.n} time of "${e.quote}"`);
          assert.ok(m.sentAt! <= DEMO_TIMELINE.evidenceAsOf);
        } else {
          assert.equal(e.by, null);
        }
      }
    }
  });

  it("attributes are valid for each category, and titles and statements fit the product's limits", () => {
    for (const p of DEMO_POINTS) {
      const r = parsePointAttributes(p.category as never, p.attributes);
      assert.ok(r.success, `#${p.n} ${p.key}: ${r.success ? "" : JSON.stringify(r.error.issues)}`);
      assert.ok(p.title.length <= 120 && p.statement.length <= 1000, `#${p.n} length`);
    }
    // The manual-point schema is the strictest public check of a category/attribute pair.
    for (const p of DEMO_POINTS.slice(0, 1)) {
      const r = createManualPointInput.safeParse({ handoverId: "00000000-0000-4000-8000-000000000001", category: p.category, title: p.title, statement: p.statement, attributes: p.attributes });
      assert.ok(r.success, JSON.stringify(r.success ? null : r.error.issues));
    }
  });

  it("covers the honest labels: 17 sourced, 1 inferred, 1 conflicting, 2 missing", () => {
    const by = (s: EvidenceStatus) => DEMO_POINTS.filter((p) => seedStatus(p) === s).map((p) => p.key);
    assert.equal(by("sourced").length, 17);
    assert.deepEqual(by("inferred"), ["weekly_meeting"]);
    assert.deepEqual(by("conflicting"), ["workshop_fee"]);
    assert.deepEqual(by("missing"), ["discord_admin", "instagram_account"]);
    const inferred = DEMO_POINTS.find((p) => p.key === "weekly_meeting")!;
    assert.ok(inferred.rationale && inferred.evidence.every((e) => e.verdict === "partial"));
  });

  it("numbers points densely and uniquely; only clear-cut sourced points are pre-approved", () => {
    assert.deepEqual(DEMO_POINTS.map((p) => p.n), DEMO_POINTS.map((_, i) => i + 1));
    assert.equal(new Set(DEMO_POINTS.map((p) => p.key)).size, DEMO_POINTS.length);
    for (const p of DEMO_POINTS.filter((x) => x.atReviewStart === "approved")) {
      assert.equal(seedStatus(p), "sourced", `${p.key} is pre-approved, so it must be sourced`);
      assert.ok(p.evidence.every((e) => e.verdict === "supports"), `${p.key}: pre-approved points have no doubtful evidence`);
    }
    assert.deepEqual(
      DEMO_POINTS.filter((p) => p.atReviewStart === "pending").map((p) => p.key),
      ["workshop_fee", "weekly_meeting", "tshirts", "discord_admin", "reimbursements", "domain_renewal", "instagram_account"],
    );
  });

  it("only one approved point is 'possibly outdated' (latest dated support > 30 days before evidence-as-of)", () => {
    const cutoff = Date.parse(DEMO_TIMELINE.evidenceAsOf) - 30 * 86_400_000;
    const outdated = DEMO_POINTS.filter((p) => seedStatus(p) === "sourced" && p.atReviewStart === "approved").filter((p) => {
      const dated = p.evidence.filter((e) => e.verdict === "supports" && DEMO_SOURCES[e.source].kind === "whatsapp_export").map((e) => Date.parse(messageFor(e).sentAt!));
      return dated.length > 0 && Math.max(...dated) < cutoff;
    });
    assert.deepEqual(outdated.map((p) => p.key), ["projector"]);
  });

  it("gap questions point at the missing points; the Gap Interview answer matches the canonical path", () => {
    for (const q of DEMO_GAP_QUESTIONS) assert.equal(seedStatus(DEMO_POINTS.find((p) => p.key === q.point)!), "missing");
    const submit = DEMO_CANONICAL_ACTIONS.find((a) => a.action === "submit_gap_answer");
    assert.ok(submit && submit.action === "submit_gap_answer");
    assert.equal(submit.text, DEMO_GAP_ANSWER.text);
    assert.equal(submit.question, DEMO_GAP_ANSWER.question);
  });
});

describe("demo scenario: the canonical path", () => {
  it("references real points and evidence, satisfies the review rules and stays within input limits", () => {
    for (const a of DEMO_CANONICAL_ACTIONS) {
      if (!("point" in a)) continue;
      const p = DEMO_POINTS.find((x) => x.key === a.point);
      assert.ok(p, `unknown point ${a.point}`);
      if (a.action === "edit") {
        const r = parsePointAttributes(p.category as never, a.attributes);
        assert.ok(r.success, `edit of ${a.point}: ${r.success ? "" : JSON.stringify(r.error.issues)}`);
        assert.ok(a.title.length <= 120 && a.statement.length <= 1000 && a.editReason.length <= 500);
      }
      if (a.action === "exclude_evidence") assert.ok(p.evidence[a.evidenceIndex], `evidence ${a.evidenceIndex} of ${a.point}`);
    }
    const approve = (k: string) => DEMO_CANONICAL_ACTIONS.find((a) => a.action === "approve" && a.point === k && a.step === "review");
    assert.ok(approve("weekly_meeting") && "confirmInferred" in approve("weekly_meeting")!, "inferred points are confirmed when approved");
    for (const k of ["discord_admin", "instagram_account"]) assert.ok(approve(k) && "asKnownGap" in approve(k)!, `${k} is approved as a known gap`);
    const fee = DEMO_CANONICAL_ACTIONS.filter((a) => "point" in a && a.point === "workshop_fee").map((a) => a.action);
    assert.deepEqual(fee, ["edit", "resolve_conflict", "approve"], "the conflict is corrected, resolved, then approved");
  });

  it("decides every pending point before v1 is published", () => {
    const publishIndex = DEMO_CANONICAL_ACTIONS.findIndex((a) => a.action === "publish");
    const decided = new Set(
      DEMO_CANONICAL_ACTIONS.slice(0, publishIndex).flatMap((a) => ((a.action === "approve" || a.action === "reject") && "point" in a ? [a.point] : [])),
    );
    for (const p of DEMO_POINTS.filter((x) => x.atReviewStart === "pending")) assert.ok(decided.has(p.key), `${p.key} must be decided before publishing`);
  });

  it("user-entered text (corrections, notes, summaries, the answer) has no contact details or credentials", () => {
    const texts = DEMO_CANONICAL_ACTIONS.flatMap((a) => Object.values(a).filter((v): v is string => typeof v === "string"));
    for (const t of [...texts, ...DEMO_GAP_QUESTIONS.flatMap((q) => [q.question, q.context])]) {
      const masked = maskText({ text: t, context: "user_input" }).text;
      assert.equal(masked, t, `masking would change: ${t}`);
      assert.doesNotMatch(masked, CREDENTIAL_TOKEN);
    }
  });

  it("the cast uses only the synthetic patterns", () => {
    for (const c of Object.values(DEMO_CAST)) {
      assert.match(c.email, /^[a-z.]+@example\.org$/);
      assert.match(c.phone, /^99999 000\d\d$/);
    }
  });
});
