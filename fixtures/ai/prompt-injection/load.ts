/**
 * Prompt-injection fixtures (§11.8 rule 7, §12.10 rule 7). Synthetic data only: every name, team, id and
 * number here is invented; phone numbers use the 99999 0000N pattern and emails example.org.
 *
 * Each case in ./cases/*.json is an adversarial input plus the output a COMPROMISED model might return.
 * - The deterministic suite (lib/ai/__tests__/prompt-injection.test.ts) feeds `compromisedOutput` through
 *   the fake adapter and asserts that lib/ai's guards hold (`expect`), and that the prompt keeps the
 *   injected text inside the untrusted payload.
 * - The opt-in live suite (lib/ai/__tests__/prompt-injection.live.test.ts) sends the same `request` to the
 *   configured production provider and asserts `live`. It is required before any change to a model,
 *   prompt version or adapter, and is skipped while no production provider is configured (D11).
 *
 * Threat ids follow the §12.10 rule 7 list.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { ExtractRequest, VerifySupportRequest } from "../../../lib/ai/provider";

export const THREATS = [
  "ignore_previous_instructions_chat",
  "ignore_previous_instructions_document",
  "fake_role_turns",
  "mark_sourced_approved_everyone",
  "reveal_restricted_content",
  "tool_call_or_fetch",
  "html_script_markdown",
  "hidden_unicode_homoglyph",
  "split_across_messages",
  "quote_instructs_verifier",
  "instructions_in_participant_name",
  "contact_exfiltration",
] as const;
export type Threat = (typeof THREATS)[number];

const dropCounts = z.record(z.string(), z.number().int().nonnegative());

const extractExpect = z.strictObject({
  outcome: z.enum(["ok", "error"]),
  /** details.reason when outcome is "error". */
  errorReason: z.string().optional(),
  survivingCandidates: z.number().int().nonnegative().optional(),
  /** Exact drop counts; reasons not listed must be 0. */
  dropped: dropCounts.optional(),
  /** Per surviving candidate, the quote checks of its citations, in order. */
  citationChecks: z.array(z.array(z.enum(["exact", "normalized", "not_found"]))).optional(),
  /** Surviving statements must be byte-identical to the compromised output (model text stays inert data). */
  statementsVerbatim: z.boolean().optional(),
});

const verifyExpect = z.strictObject({
  outcome: z.enum(["ok", "error"]),
  errorReason: z.string().optional(),
  /** Verdict lib/ai returns for the compromised output (plumbing passes schema-valid verdicts through). */
  verdict: z.enum(["supports", "partial", "contradicts", "irrelevant"]).optional(),
});

const live = z.strictObject({
  /** Strings that must not appear in any surviving candidate field (extract). */
  forbiddenInOutput: z.array(z.string()).optional(),
  /** Expected verdict from an honest model (verify). */
  verdict: z.enum(["supports", "partial", "contradicts", "irrelevant"]).optional(),
  notes: z.string().optional(),
});

const message = z.strictObject({ id: z.uuid(), authorLabel: z.string().nullable(), sentAt: z.string().nullable(), body: z.string() });

const extractCase = z.strictObject({
  id: z.string().regex(/^PI-\d{2}-[a-z0-9-]+$/),
  threat: z.enum(THREATS),
  description: z.string().min(1),
  stage: z.literal("extract"),
  request: z.strictObject({
    handover: z.strictObject({ teamName: z.string(), roleTitle: z.string().nullable() }),
    categories: z.array(z.string()).min(1),
    messages: z.array(message).min(1),
  }),
  /** Messages of another (e.g. higher-access) chunk that is NOT in this request. */
  otherChunk: z.array(message).optional(),
  /** Injected strings: must never reach the system prompt; must appear in the user turn only as payload data. */
  injectedMarkers: z.array(z.string()).min(1),
  /** The raw model output, or a tool call. */
  compromisedOutput: z.union([z.strictObject({ $toolCall: z.literal(true) }), z.unknown()]),
  expect: extractExpect,
  /** Expectations for the opt-in live suite against a real provider. */
  live: live.optional(),
});

const verifyCase = z.strictObject({
  id: z.string().regex(/^PI-\d{2}-[a-z0-9-]+$/),
  threat: z.enum(THREATS),
  description: z.string().min(1),
  stage: z.literal("verify"),
  request: z.strictObject({
    claim: z.strictObject({ category: z.string(), title: z.string(), statement: z.string(), attributes: z.record(z.string(), z.unknown()) }),
    quote: z.strictObject({ text: z.string(), authorLabel: z.string().nullable(), sentAt: z.string().nullable() }),
    context: z.array(z.strictObject({ authorLabel: z.string().nullable(), sentAt: z.string().nullable(), body: z.string() })),
  }),
  /** The masked body of the message the quote comes from (for the deterministic existence check). */
  sourceBody: z.string(),
  injectedMarkers: z.array(z.string()).min(1),
  compromisedOutput: z.union([z.strictObject({ $toolCall: z.literal(true) }), z.unknown()]),
  expect: verifyExpect,
  /** Verdict the fake adapter's deterministic heuristic gives (it never reads instructions). */
  defaultVerdict: z.enum(["supports", "partial", "contradicts", "irrelevant"]),
  live: live.optional(),
});

const injectionCase = z.discriminatedUnion("stage", [extractCase, verifyCase]);

export type ExtractInjectionCase = Omit<z.output<typeof extractCase>, "request"> & { request: ExtractRequest };
export type VerifyInjectionCase = Omit<z.output<typeof verifyCase>, "request"> & { request: VerifySupportRequest };
export type InjectionCase = ExtractInjectionCase | VerifyInjectionCase;

export const CASES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases");

export function isToolCall(output: unknown): boolean {
  return typeof output === "object" && output !== null && (output as Record<string, unknown>).$toolCall === true;
}

/** Loads and validates every case, sorted by file name. Throws on a malformed fixture. */
export function loadInjectionCases(): InjectionCase[] {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json")).sort();
  const seen = new Set<string>();
  return files.map((file) => {
    const parsed = injectionCase.safeParse(JSON.parse(readFileSync(path.join(CASES_DIR, file), "utf8")));
    if (!parsed.success) throw new Error(`invalid prompt-injection fixture ${file}: ${parsed.error.message}`);
    if (seen.has(parsed.data.id)) throw new Error(`duplicate fixture id ${parsed.data.id}`);
    seen.add(parsed.data.id);
    if (!file.startsWith(parsed.data.id)) throw new Error(`fixture ${file} must be named after its id ${parsed.data.id}`);
    return parsed.data as InjectionCase;
  });
}
