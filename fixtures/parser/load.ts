/** Test-only helpers for loading synthetic fixtures and building parser inputs. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExclusionRuleMode } from "../../lib/contracts/enums";
import {
  isParserInputFailure,
  type ConversationExclusionRule,
  type ParseContext,
  type ParserError,
  type ParserInputFailure,
  type ParserResult,
  type ParseSourceInput,
  type ParticipantExclusionRule,
} from "../../lib/contracts/parser";
import { IDENTITY_PEPPER_VERSION, computeIdentityHash, identityKindOf } from "../../lib/privacy/identity";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A synthetic pepper used only in tests (≥ 32 characters). */
export const TEST_PEPPER = "test-only-pepper-0123456789abcdef0123456789";

export function fixtureBytes(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(HERE, relativePath)));
}

export function input(overrides: Partial<ParseSourceInput> & Pick<ParseSourceInput, "kind" | "bytes">): ParseSourceInput {
  return {
    fileName: "fixture",
    timezone: "Asia/Kolkata",
    exclusions: [],
    identityPepper: TEST_PEPPER,
    ...overrides,
  };
}

/** A canonical participant rule for a sender string as exported (kind, hash and version computed). */
export function participantRule(
  rawSender: string,
  mode: ExclusionRuleMode = "apply",
  ruleId?: string,
): ParticipantExclusionRule {
  const rule: ParticipantExclusionRule = {
    kind: "participant",
    identityKind: identityKindOf(rawSender),
    participantIdentityHash: computeIdentityHash(rawSender, TEST_PEPPER),
    identityPepperVersion: IDENTITY_PEPPER_VERSION,
    mode,
  };
  if (ruleId !== undefined) rule.ruleId = ruleId;
  return rule;
}

/** A canonical conversation rule bound to the context it was chosen in (normally a preview's). */
export function conversationRule(
  conversationLocalId: string,
  context: ParseContext,
  ruleId?: string,
): ConversationExclusionRule {
  const rule: ConversationExclusionRule = { kind: "conversation", conversationLocalId, context: { ...context } };
  if (ruleId !== undefined) rule.ruleId = ruleId;
  return rule;
}

/** The file failure of a result; fails the test if it succeeded or failed on input. */
export function fileError(r: ParserResult<unknown>): ParserError {
  assert.ok(!r.ok, "expected a failure");
  assert.ok(!isParserInputFailure(r.error), `expected a file failure, got input failure ${JSON.stringify(r.error)}`);
  return r.error;
}

/** The input failure of a result; fails the test if it succeeded or failed on the file. */
export function inputFailure(r: ParserResult<unknown>): ParserInputFailure {
  assert.ok(!r.ok, "expected a failure");
  assert.ok(isParserInputFailure(r.error), `expected an input failure, got ${JSON.stringify(r.error)}`);
  return r.error;
}
