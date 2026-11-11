// IT-14 (QA-H1, §12.1, I3 amendment 3): every Server Function that persists user-entered text masks it
// before the database sees it. Each action below is called through its REAL export with planted synthetic
// PII in every free-text field; the RPC that writes must be called, and its arguments must contain no raw
// value. The one documented exception, `contact.directContact` (D5), is checked to pass through unchanged
// at leads_only. Each action also writes exactly its own RPC and nothing else (no hidden approve/publish).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import type { Result } from "../../lib/contracts/api";
import * as gaps from "../../lib/actions/gaps";
import * as handovers from "../../lib/actions/handovers";
import * as review from "../../lib/actions/review";
import * as sources from "../../lib/actions/sources";
import { getVerifiedActor } from "../../lib/db/actor";
import { createHandover as createHandoverRow } from "../../lib/db/mutations";
import { WRITE_RPCS, actionWorld, type ActionWorld } from "./support/actions";
import { gapQuestionRow, handoverRow, pointDetailRow } from "./support/rows";
import { PLANTED, assertNoLeaks } from "./support/sentinels";

const P = PLANTED;
const TOKEN = "QkF0T24tSW50ZWdyYXRpb24tVGVzdC1Ub2tlbi0wMDE"; // 43-char synthetic base64url

interface Case {
  name: string;
  rpc: string;
  run: (w: ActionWorld) => Promise<Result<unknown>>;
  setup?: (w: ActionWorld) => void;
}

const decisionAttributes = () => ({
  decidedAt: null,
  decidedByLabel: `Ask ${P.phone}`,
  rationale: `Mail ${P.email} or pay ${P.upi}`,
  alternativesConsidered: [`card ${P.card}`],
});

const CASES: Case[] = [
  {
    name: "createHandover (title, team, role title, description)",
    rpc: "create_handover",
    setup: (w) => w.adminDb.returns("create_handover", w.ids.handover),
    run: () => handovers.createHandover({
      title: `Treasurer ${P.phone}`, teamName: `Team ${P.email}`, roleTitle: `Pay ${P.upi}`,
      description: `${P.password}; ${P.apiKey}; ${P.card}; ${P.bank}`, creatorRole: "outgoing",
    }),
  },
  {
    name: "publishHandover (summary)",
    rpc: "publish_handover",
    setup: (w) => w.adminDb.returns("publish_handover", randomUUID()),
    run: (w) => handovers.publishHandover({ handoverId: w.ids.handover, summary: `Call ${P.phone}, mail ${P.email}` }),
  },
  {
    name: "createSourceUpload (file name becomes the source title)",
    rpc: "create_source",
    setup: (w) => w.adminDb.returns("create_source", w.ids.source),
    run: (w) => sources.createSourceUpload({ handoverId: w.ids.handover, kind: "whatsapp_export",
      fileName: `WhatsApp Chat with ${P.phone}.txt`, mimeType: "text/plain", sizeBytes: 100, sha256: "cd".repeat(32) }),
  },
  {
    name: "addExclusion (reason)",
    rpc: "add_exclusion",
    setup: (w) => w.adminDb.returns("add_exclusion", randomUUID()),
    run: (w) => sources.addExclusion({ kind: "date_range", sourceId: w.ids.source, scope: "source", rangeStart: "2026-01-01T00:00:00Z",
      rangeEnd: "2026-01-02T00:00:00Z", reason: `${P.email} asked to be left out, call ${P.phone}` }),
  },
  {
    name: "createGapQuestion (question, context)",
    rpc: "create_gap_question",
    setup: (w) => {
      w.adminDb.returns("create_gap_question", w.ids.question);
      w.userDb.returns("api_list_gap_questions", [gapQuestionRow(w.ids.question)]);
    },
    run: (w) => gaps.createGapQuestion({ handoverId: w.ids.handover, category: "owner", question: `Is ${P.email} still the owner?`,
      context: `They said ${P.phone} and ${P.upi}`, priority: "optional", accessLevel: "everyone" }),
  },
  {
    name: "submitGapAnswers with a session (answers)",
    rpc: "submit_gap_answers",
    setup: (w) => w.adminDb.returns("submit_gap_answers", 2),
    run: (w) => gaps.submitGapAnswers({ answers: [
      { gapQuestionId: w.ids.question, answerText: `Call ${P.phone} or ${P.email}` },
      { gapQuestionId: randomUUID(), answerText: `${P.password}, card ${P.card}` },
    ] }),
  },
  {
    name: "submitGapAnswers with a token (self-declared name, answers)",
    rpc: "submit_gap_answers_with_token",
    setup: (w) => w.adminDb.returns("consume_rate_limit", true).returns("submit_gap_answers_with_token", 1),
    run: (w) => gaps.submitGapAnswers({ token: TOKEN, answererLabel: `${P.phone}`,
      answers: [{ gapQuestionId: w.ids.question, answerText: `UPI ${P.upi}, key ${P.apiKey}` }] }),
  },
  {
    name: "reviewGapAnswer (note)",
    rpc: "review_gap_answer",
    setup: (w) => w.adminDb.returns("review_gap_answer", null),
    run: (w) => gaps.reviewGapAnswer({ answerId: w.ids.answer, decision: "reject", note: `Wrong, use ${P.email}` }),
  },
  ...(
    [
      ["approve (resolution note)", "approve_point", (w: ActionWorld) => ({ action: "approve", pointId: w.ids.point,
        expectedRevisionId: randomUUID(), resolutionNote: `Confirmed with ${P.phone}` })],
      ["reject (reason)", "reject_point", (w: ActionWorld) => ({ action: "reject", pointId: w.ids.point, reason: `Ask ${P.email}` })],
      ["reopen (note)", "reopen_point", (w: ActionWorld) => ({ action: "reopen", pointId: w.ids.point, note: `${P.upi} changed` })],
      ["confirm_inferred (note)", "confirm_inferred", (w: ActionWorld) => ({ action: "confirm_inferred", pointId: w.ids.point,
        note: `${P.password}` })],
      ["resolve_conflict (note)", "resolve_conflict", (w: ActionWorld) => ({ action: "resolve_conflict", pointId: w.ids.point,
        resolutionNote: `The newer number ${P.phone} wins` })],
      ["exclude_evidence (reason)", "exclude_evidence", (w: ActionWorld) => ({ action: "exclude_evidence", pointId: w.ids.point,
        pointEvidenceId: w.ids.evidence, reason: `Mentions ${P.card}` })],
      ["edit (title, statement, attributes, reason)", "edit_point", (w: ActionWorld) => ({ action: "edit", pointId: w.ids.point,
        expectedRevisionId: randomUUID(), title: `Owner ${P.phone}`, statement: `Pay ${P.upi}, mail ${P.email}`,
        attributes: decisionAttributes(), editReason: `${P.apiKey} was wrong` })],
      ["resolve_privacy_review (redacted point, surface replacements)", "resolve_privacy_review", (w: ActionWorld) => ({
        action: "resolve_privacy_review", pointId: w.ids.point, expectedRevisionId: randomUUID(), surfacesDigest: "d".repeat(64),
        decision: "redact",
        redacted: { title: `Owner ${P.phone}`, statement: `Mail ${P.email}`, attributes: decisionAttributes(),
          inferenceRationale: `${P.upi}`, conflictResolutionNote: `${P.card}` },
        surfaces: [{ kind: "review_note", id: randomUUID(), decision: "redact", replacement: { note: `Call ${P.phone}` } }],
      })],
    ] as Array<[string, string, (w: ActionWorld) => unknown]>
  ).map(([label, rpc, input]): Case => ({
    name: `reviewPoint ${label}`,
    rpc,
    setup: (w) => {
      w.adminDb.returns(rpc, null);
      w.userDb.returns("api_get_point", pointDetailRow(w.ids.point, "decision"));
    },
    run: (w) => review.reviewPoint(input(w) as never),
  })),
  {
    name: "createManualPoint (title, statement, rationale, testimony, attributes)",
    rpc: "create_manual_point",
    setup: (w) => {
      w.adminDb.returns("create_manual_point", w.ids.point);
      w.userDb.returns("api_get_point", pointDetailRow(w.ids.point, "decision"));
    },
    run: (w) => review.createManualPoint({ handoverId: w.ids.handover, category: "decision", title: `Bank ${P.bank}`,
      statement: `Pay ${P.upi}`, inferenceRationale: `From ${P.email}`, testimony: { text: `I hold ${P.card}, ${P.password}`,
        accessLevel: "everyone" }, attributes: decisionAttributes() }),
  },
];

describe("IT-14: user-entered text is masked before any write", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const w = actionWorld();
      c.setup?.(w);
      await c.run(w);
      const call = w.adminDb.last(c.rpc);
      assert.ok(call, `${c.rpc} was called (masking must not turn a valid input into a refusal): ${w.adminDb.fns().join(", ")}`);
      assertNoLeaks(call.args, `${c.rpc} arguments`);
      const writes = w.adminDb.fns().filter((fn) => (WRITE_RPCS as readonly string[]).includes(fn));
      assert.deepEqual(writes, [c.rpc], "exactly one write, the action's own");
    });
  }

  it("control: the same text written without the action's masking IS caught by the scanner", async () => {
    const w = actionWorld();
    w.adminDb.returns("create_handover", w.ids.handover);
    const actor = await getVerifiedActor();
    assert.ok(actor);
    await createHandoverRow(w.adminDb, actor, { title: `Treasurer ${P.phone}`, teamName: `Team ${P.email}`, creatorRole: "outgoing" });
    assert.throws(() => assertNoLeaks(w.adminDb.last("create_handover")?.args, "unmasked"), /raw PII/);
  });

  it("masking is consistent within one request (same value → same token across fields)", async () => {
    const w = actionWorld();
    w.adminDb.returns("create_handover", w.ids.handover);
    w.userDb.returns("api_get_handover", handoverRow(w.ids.handover));
    await handovers.createHandover({ title: `Call ${P.phone}`, teamName: "Team", description: `Again ${P.phone}`, creatorRole: "outgoing" });
    const args = w.adminDb.last("create_handover")?.args as { p_title: string; p_description: string };
    const token = /\[PHONE_\d+\]/.exec(args.p_title)?.[0];
    assert.ok(token, args.p_title);
    assert.ok(args.p_description.includes(token));
  });

  it("D5: a typed-in direct contact is the only unmasked value, and only at leads_only or stricter", async () => {
    const w = actionWorld();
    w.adminDb.returns("create_manual_point", w.ids.point);
    w.userDb.returns("api_get_point", pointDetailRow(w.ids.point, "contact"));
    const directContact = { channel: "phone" as const, value: "+91 99999 00008" };
    const contact = { nameLabel: `Asha ${P.email}`, organisation: null, roleDescription: null, preferredChannel: null, directContact };
    const refused = await review.createManualPoint({ handoverId: w.ids.handover, category: "contact", title: "Sponsor", statement: "Contact",
      attributes: contact });
    assert.ok(!refused.ok && refused.error.code === "validation_failed", "everyone-level direct contact is refused");
    assert.ok(!w.adminDb.called("create_manual_point"));

    await review.createManualPoint({ handoverId: w.ids.handover, category: "contact", title: "Sponsor", statement: "Contact",
      accessOverride: "leads_only", attributes: contact });
    const args = w.adminDb.last("create_manual_point")?.args as { p_attributes: { nameLabel: string; directContact: unknown } };
    assert.deepEqual(args.p_attributes.directContact, directContact, "the direct contact passes through unchanged");
    assertNoLeaks(args.p_attributes.nameLabel, "other attribute text is still masked");
  });
});
