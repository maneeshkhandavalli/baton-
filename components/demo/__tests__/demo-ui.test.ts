// R3 Task 06: the interactive demo's pure UI logic (components/demo/demo-{guide,dispatch,view-model}.ts) and its
// safety boundaries (contract §2.6, A3). The engine itself is Worker 01's and is tested in lib/demo/__tests__.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Result } from "@/lib/contracts/api";
import type { DemoQueries, DemoSession } from "@/lib/demo/engine/index";
import { DEMO_STEPS } from "@/lib/demo/scenario/journey";

import type { ChangeReviewItem } from "@/lib/contracts/change-review";
import { DEMO_STORAGE_KEY as ENGINE_STORAGE_KEY } from "@/lib/demo/engine/index";

import {
  acknowledgePublication,
  changeDecisionInput,
  decideChangeReview,
  demoErrorText,
  demoResultText,
  isDemoReviewAction,
  publishHandover,
  readStoredSession,
  reviewGapAnswer,
  reviewPoint,
  submitGapAnswer,
  writeStoredSession,
} from "../demo-dispatch";
import { adjacentStep, DEMO_FRAMING, DEMO_STEP_GUIDE, DEMO_STORAGE_KEY, initialStepFromQuery, parseStepParam, stepNumber } from "../demo-guide";
import { answersToReview, gapForPoint, loadDemoView, SCREEN_NEEDS } from "../demo-view-model";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const UUID = "00000000-0000-4000-8000-000000000001";

describe("demo guide", () => {
  it("every journey step has a screen, a viewer and plain guidance for a judge", () => {
    for (const s of DEMO_STEPS) {
      const g = DEMO_STEP_GUIDE[s.id];
      assert.ok(g, s.id);
      for (const k of ["title", "what", "tryThis", "why", "as"] as const) assert.ok(g[k].length > 5, `${s.id}.${k}`);
      assert.equal(g.viewer, s.actor === "neha" ? "neha" : "priya", s.id);
    }
  });
  it("framing and storage key are fixed by the contract", () => {
    assert.equal(DEMO_FRAMING, "Demo · nothing is saved or sent");
    assert.equal(DEMO_STORAGE_KEY, "baton.demo.v1");
    assert.equal(DEMO_STORAGE_KEY, ENGINE_STORAGE_KEY);
  });
  it("step parsing and navigation", () => {
    assert.equal(parseStepParam("review"), "review");
    for (const bad of ["nope", "", undefined, ["review"], 3]) assert.equal(parseStepParam(bad), null);
    // a link: no step resumes this tab's demo; an unknown step opens the first step (never the last-seen one)
    assert.equal(initialStepFromQuery(undefined), null);
    assert.equal(initialStepFromQuery("review"), "review");
    for (const bad of ["bogus", "", ["review"]]) assert.equal(initialStepFromQuery(bad), DEMO_STEPS[0].id);
    assert.equal(stepNumber("sources"), 1);
    assert.equal(adjacentStep("sources", -1), null);
    assert.equal(adjacentStep("sources", 1), "draft");
    assert.equal(adjacentStep("receive", 1), null);
  });
});

describe("demo dispatch (A7 action union)", () => {
  it("builds each action with the real input shapes", () => {
    const approve = { action: "approve" as const, pointId: UUID, expectedRevisionId: UUID };
    assert.deepEqual(reviewPoint(approve), { type: "reviewPoint", input: approve });
    assert.deepEqual(publishHandover(UUID, "  "), { type: "publish", input: { handoverId: UUID } });
    assert.deepEqual(publishHandover(UUID, " note "), { type: "publish", input: { handoverId: UUID, summary: "note" } });
    assert.deepEqual(acknowledgePublication(UUID, "v1"), { type: "acknowledge", input: { publicationId: UUID, statementVersion: "v1" } });
    assert.deepEqual(submitGapAnswer(UUID, " text ", "Ananya Iyer"), {
      type: "submitGapAnswers",
      input: { answererLabel: "Ananya Iyer", answers: [{ gapQuestionId: UUID, answerText: "text" }] },
    });
    assert.deepEqual(reviewGapAnswer(UUID, "accept"), { type: "reviewGapAnswer", input: { answerId: UUID, decision: "accept" } });
    assert.equal(decideChangeReview({ itemId: UUID, decision: "reject", note: "x" } as never).type, "decideChangeReview");
  });

  it("only the five demo review actions are sent; the rest are left out before reaching the engine", () => {
    for (const a of ["approve", "reject", "edit", "confirm_inferred", "resolve_conflict"]) assert.equal(isDemoReviewAction({ action: a } as never), true, a);
    for (const a of ["reopen", "exclude_evidence", "restore_evidence", "change_access", "resolve_privacy_review"]) assert.equal(isDemoReviewAction({ action: a } as never), false, a);
  });

  it("result messages: demo refusals say what the demo can do; never a raw code", () => {
    assert.deepEqual(demoResultText({ ok: true, data: null }, "Done"), { ok: true, text: "Done" });
    const refused: Result<unknown> = { ok: false, error: { code: "forbidden", message: "Forbidden", retryable: false, details: { reason: "demo_read_only" } } };
    assert.match(demoResultText(refused, "x").text, /isn't part of the demo/);
    assert.equal(demoErrorText({ code: "invalid_transition", message: "Resolve the conflict first." }), "Resolve the conflict first.");
    assert.match(demoErrorText({ code: "internal", message: "" }), /reset the demo/);
  });

  it("session storage is best effort and validated through the engine's parser", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const s = { id: "x", version: 1, startedAt: "2026-11-18T00:00:00.000Z", step: "review", log: [] } as unknown as DemoSession;
    const codec = { serialize: (v: DemoSession) => JSON.stringify(v), parse: (raw: unknown) => (typeof raw === "string" && raw.startsWith("{") ? (JSON.parse(raw) as DemoSession) : null) };
    assert.equal(readStoredSession(storage, DEMO_STORAGE_KEY, codec), null);
    writeStoredSession(storage, DEMO_STORAGE_KEY, codec, s);
    assert.deepEqual(readStoredSession(storage, DEMO_STORAGE_KEY, codec), s);
    store.set(DEMO_STORAGE_KEY, "garbage");
    assert.equal(readStoredSession(storage, DEMO_STORAGE_KEY, codec), null);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    assert.equal(readStoredSession(throwing, DEMO_STORAGE_KEY, codec), null);
    assert.doesNotThrow(() => writeStoredSession(throwing, DEMO_STORAGE_KEY, codec, s));
    assert.equal(readStoredSession(null, DEMO_STORAGE_KEY, codec), null);
  });
});

describe("changeDecisionInput (Task 05E inputs per kind)", () => {
  const item = (over: Partial<ChangeReviewItem> = {}): ChangeReviewItem =>
    ({
      id: "i1", kind: "evidence_missing", state: "open",
      point: { id: "p1", category: "risk", reviewState: "approved", evidenceStatus: "sourced", currentRevisionId: "r1", title: "T", statement: "S", attributes: { a: 1 } },
      newMessage: { id: "m", body: "new words here", sentAt: null, authorLabel: null, quoteStart: null, quoteEnd: null },
      ...over,
    }) as ChangeReviewItem;
  it("carries the state and point revision the reviewer saw", () => {
    assert.deepEqual(changeDecisionInput(item(), "h", "reject", { note: " no " }), { handoverId: "h", itemId: "i1", decision: "reject", expectedState: "open", expectedPointRevisionId: "r1", note: "no" });
    assert.equal(changeDecisionInput(item({ state: "investigating" }), "h", "accept")?.expectedState, "investigating");
  });
  it("a contradiction accepted is a correction backed by the new message", () => {
    const c = changeDecisionInput(item({ kind: "possible_contradiction" }), "h", "accept", { note: "n", correction: { title: " T2 ", statement: " S2 " } });
    assert.deepEqual(c?.correction, { title: "T2", statement: "S2", attributes: { a: 1 }, evidenceStart: 0, evidenceEnd: 14 });
  });
  it("new information carries the approval its status needs", () => {
    const point = item().point!;
    assert.deepEqual(changeDecisionInput(item({ kind: "new_information", point: { ...point, evidenceStatus: "inferred" } }), "h", "accept")?.approval, { confirmInferred: true });
    assert.deepEqual(changeDecisionInput(item({ kind: "new_information", point: { ...point, evidenceStatus: "missing" } }), "h", "accept")?.approval, { asKnownGap: true });
  });
  it("nothing to decide: no point, or already resolved", () => {
    assert.equal(changeDecisionInput(item({ point: null }), "h", "accept"), null);
    assert.equal(changeDecisionInput(item({ state: "accepted" }), "h", "accept"), null);
  });
});

describe("demo view model", () => {
  const ok = <T>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });
  const calls: string[] = [];
  const fake = (name: string) =>
    ({
      listMyHandovers: () => (calls.push(`${name}:handovers`), ok([{ id: "h1", title: "T" }])),
      listSources: () => (calls.push(`${name}:sources`), ok([{ id: "s1" }])),
      getProcessingStatus: () => (calls.push(`${name}:processing`), ok({ handoverState: "in_review", run: null })),
      listPoints: () => (calls.push(`${name}:points`), ok([{ id: "p1" }, { id: "p2" }])),
      getPoint: (id: string) => (calls.push(`${name}:point:${id}`), id === "p2" ? Promise.resolve({ ok: false, error: { code: "not_found", message: "", retryable: false } }) : ok({ id })),
      getReadiness: () => (calls.push(`${name}:readiness`), ok({ canPublish: false, blockers: [], counts: {}, score: 0 })),
      getExtractionReport: () => (calls.push(`${name}:extraction`), ok({ available: true })),
      listGapQuestions: () => (calls.push(`${name}:gaps`), ok([])),
      getPublishedHandover: () => (calls.push(`${name}:published`), Promise.resolve({ ok: false, error: { code: "not_found", message: "", retryable: false } })),
      getChangeReviews: () => (calls.push(`${name}:changes`), ok([])),
    }) as unknown as DemoQueries;

  it("reads only what the screen needs; gap questions through the reviewer; missing points are skipped", async () => {
    calls.length = 0;
    const r = await loadDemoView("receive", fake("neha"), fake("priya"));
    assert.equal(r.ok, true);
    assert.ok(calls.includes("priya:gaps") && calls.includes("neha:published") && calls.includes("priya:changes"));
    assert.ok(!calls.some((c) => c.endsWith(":points") || c.endsWith(":sources")));
    if (r.ok) assert.equal(r.view.published, null);

    calls.length = 0;
    const review = await loadDemoView("review", fake("priya"));
    assert.ok(review.ok && review.view.points.length === 1);
    assert.deepEqual(SCREEN_NEEDS.sources, ["sources"]);
  });

  it("no handover → a message, not a crash", async () => {
    const empty = { listMyHandovers: () => ok([]) } as unknown as DemoQueries;
    const r = await loadDemoView("review", empty);
    assert.equal(r.ok, false);
  });

  it("gap helpers", () => {
    const gaps = [
      { id: "g1", pointId: "p1", status: "answered", answers: [{ id: "a2", status: "submitted", privacyHeld: false, createdAt: "2026-11-14T02:00:00Z" }, { id: "a1", status: "submitted", privacyHeld: false, createdAt: "2026-11-14T01:00:00Z" }, { id: "a3", status: "accepted", privacyHeld: false, createdAt: "2026-11-14T00:00:00Z" }] },
      { id: "g2", pointId: null, status: "open", answers: [{ id: "a4", status: "submitted", privacyHeld: true, createdAt: "2026-11-14T00:00:00Z" }] },
    ] as never;
    assert.equal(gapForPoint(gaps, "p1")?.id, "g1");
    assert.deepEqual(answersToReview(gaps).map((x) => x.answer.id), ["a1", "a2"]);
  });
});

describe("demo safety boundaries (contract §2.6, A3)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? (e.name === "__tests__" ? [] : files(full)) : /\.(ts|tsx)$/.test(e.name) ? [full] : [];
    });
  const sources = [...files(path.join(ROOT, "components/demo")), ...files(path.join(ROOT, "app/(marketing)/demo"))];

  it("the demo UI never imports actions, Supabase, the database, the mock store or server-only modules", () => {
    assert.ok(sources.length >= 5);
    for (const f of sources) {
      // code only: documentation may name what is forbidden
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      assert.doesNotMatch(text, /from "@\/lib\/(actions|supabase|db|ai|pipeline|email)\b|lib\/mocks\/store|lib\/mocks\/actions|"server-only"|next\/headers/, path.relative(ROOT, f));
      assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|process\.env/, path.relative(ROOT, f));
    }
  });

  it("the interactive workspace reads and writes only through the published engine API", () => {
    const ws = readFileSync(path.join(ROOT, "components/demo/demo-workspace.tsx"), "utf8");
    assert.match(ws, /from "@\/lib\/demo\/engine"/);
    assert.doesNotMatch(ws, /lib\/mocks/);
    assert.match(ws, /sessionStorage/);
  });
});

// With the real engine (Worker 01's lib/demo/engine): every step's screen loads, and the UI's actions are accepted.
import { applyDemoAction, demoQueries, startDemoSession } from "@/lib/demo/engine/index";
import { directApproveInput } from "@/components/review/evidence-state";

// the acknowledgement statement version the published view sends (a .tsx module, so read from its source)
const ACK_STATEMENT_VERSION = /export const ACK_STATEMENT_VERSION = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "components/published/published-handover-view.tsx"), "utf8"))![1];

describe("demo UI on the real engine", () => {
  it("every step's screen loads through the engine queries", async () => {
    for (const s of DEMO_STEPS) {
      const session = startDemoSession({ step: s.id });
      const g = DEMO_STEP_GUIDE[s.id];
      const r = await loadDemoView(g.screen, demoQueries(session, g.viewer), demoQueries(session, "priya"));
      assert.equal(r.ok, true, s.id);
      if (!r.ok) continue;
      if (g.screen === "sources") assert.ok(r.view.sources.length > 0, s.id);
      if (["draft", "review", "decisions", "publish"].includes(g.screen)) assert.ok(r.view.points.length > 0, s.id);
      if (g.screen === "receive") assert.ok(r.view.published, s.id);
    }
  });

  it("review: approving a sourced point through the adapter is accepted and changes only this session", async () => {
    const session = startDemoSession({ step: "review" });
    const r = await loadDemoView("review", demoQueries(session, "priya"));
    assert.ok(r.ok);
    if (!r.ok) return;
    const point = r.view.points.find((p) => p.reviewState === "pending" && directApproveInput(p));
    assert.ok(point, "a pending point that can be approved directly");
    const out = applyDemoAction(session, reviewPoint(directApproveInput(point!)!));
    assert.equal(out.result.ok, true, JSON.stringify(out.result));
    assert.equal(out.session.log.length, 1);
    assert.equal(session.log.length, 0);
  });

  it("receive: acknowledge as Neha and decide a source change as Priya", async () => {
    let session = startDemoSession({ step: "receive" });
    const neha = await loadDemoView("receive", demoQueries(session, "neha"), demoQueries(session, "priya"));
    assert.ok(neha.ok && neha.view.published);
    if (!neha.ok || !neha.view.published) return;
    if (!neha.view.published.viewerAcknowledgedAt) {
      const ack = applyDemoAction(session, acknowledgePublication(neha.view.published.publicationId, ACK_STATEMENT_VERSION));
      assert.equal(ack.result.ok, true, JSON.stringify(ack.result));
      session = ack.session;
    }
    const changes = neha.view.changes.filter((c) => c.state === "open");
    assert.ok(changes.length > 0, "the demo seeds change reviews after publishing");
    const input = changeDecisionInput(changes[0], neha.view.handover.id, "investigate", { note: "Checking with IT." });
    const out = applyDemoAction(session, decideChangeReview(input!));
    assert.equal(out.result.ok, true, JSON.stringify(out.result));
  });

  it("anything outside the demo is refused with demo_read_only, and the UI says so", () => {
    const session = startDemoSession({ step: "review" });
    const out = applyDemoAction(session, reviewPoint({ action: "reopen", pointId: UUID }));
    assert.equal(out.result.ok, false);
    assert.match(demoResultText(out.result, "x").text, /isn't part of the demo/);
  });
});

import { isUnknownStepQuery } from "../demo-guide";

describe("demo ?step= fallback (Round 4 audit F1)", () => {
  it("accepts step numbers and case variants, and flags values that name no step", () => {
    assert.equal(parseStepParam("3"), DEMO_STEPS[2].id);
    assert.equal(parseStepParam(" Review "), "review");
    assert.equal(parseStepParam("0"), null);
    assert.equal(parseStepParam("9"), null);
    assert.equal(initialStepFromQuery("bogus"), DEMO_STEPS[0].id);
    assert.equal(isUnknownStepQuery("bogus"), true);
    assert.equal(isUnknownStepQuery(undefined), false);
    assert.equal(isUnknownStepQuery("2"), false);
  });

  it("the workspace page tells the visitor when the step is unknown", () => {
    const page = readFileSync(path.join(ROOT, "app/(marketing)/demo/workspace/page.tsx"), "utf8");
    assert.match(page, /unknownStep=\{isUnknownStepQuery\(query\.step\)\}/);
  });
});
