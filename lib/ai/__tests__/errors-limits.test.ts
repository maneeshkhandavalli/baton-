// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_CODES } from "../../contracts/api";
import { abortedError, aiError, AI_ERROR_REASONS, providerNotConfiguredError, toolCallRejectedError } from "../errors";
import { EXTRACT_REQUEST_LIMITS, extractRequestWithinLimits, measureExtractRequest, VERIFY_REQUEST_LIMITS, verifyRequestWithinLimits } from "../limits";
import type { ExtractRequest, VerifySupportRequest } from "../provider";

describe("AI errors", () => {
  it("every reason is a valid error_message token", () => {
    for (const reason of Object.values(AI_ERROR_REASONS)) assert.match(reason, /^[a-z0-9_:]{1,64}$/);
  });

  it("uses ERROR_CODES only", () => {
    for (const e of [providerNotConfiguredError(), toolCallRejectedError(), abortedError(AbortSignal.abort())]) {
      assert.ok((ERROR_CODES as readonly string[]).includes(e.code));
    }
  });

  it("drops provider details that are not short opaque tokens (no raw bodies)", () => {
    const e = aiError({
      code: "processing_failed",
      reason: "ai_provider_error",
      retryable: true,
      providerErrorType: '{"error":{"message":"your prompt contained: Asha 99999 00001"}}',
      httpStatus: 4290,
      providerRequestId: "req abc with spaces",
    });
    assert.deepEqual(e.details, { reason: "ai_provider_error" });
    const ok = aiError({ code: "rate_limited", reason: "ai_provider_error", retryable: true, providerErrorType: "rate_limit_error", httpStatus: 429, providerRequestId: "req_01ABC" });
    assert.deepEqual(ok.details, { reason: "ai_provider_error", providerErrorType: "rate_limit_error", httpStatus: 429, providerRequestId: "req_01ABC" });
  });

  it("rejects an invalid reason token", () => {
    assert.throws(() => aiError({ code: "internal", reason: "Bad Reason" as never, retryable: false }));
  });
});

describe("request limits", () => {
  const msg = (n: number, size: number) => ({ id: `m${n}`, authorLabel: "A", sentAt: null, body: "x".repeat(size) });
  const req = (messages: ExtractRequest["messages"]): ExtractRequest => ({ handover: { teamName: "T", roleTitle: null }, categories: ["owner"], messages });

  it("measures bodies, labels and handover fields", () => {
    assert.deepEqual(measureExtractRequest(req([msg(1, 10), msg(2, 5)])), { messages: 2, chars: 1 + 11 + 6 });
  });

  it("enforces message count and character budgets", () => {
    assert.equal(extractRequestWithinLimits(req([msg(1, 100)])), true);
    assert.equal(extractRequestWithinLimits(req(Array.from({ length: EXTRACT_REQUEST_LIMITS.maxMessages + 1 }, (_, i) => msg(i, 1)))), false);
    assert.equal(extractRequestWithinLimits(req([msg(1, EXTRACT_REQUEST_LIMITS.maxChars)])), false);
  });

  it("verify requests allow at most 3 context messages", () => {
    const v = (n: number): VerifySupportRequest => ({
      claim: { category: "owner", title: "t", statement: "s", attributes: { responsibility: "r", ownerLabel: null, since: null } },
      quote: { text: "q", authorLabel: null, sentAt: null },
      context: Array.from({ length: n }, () => ({ authorLabel: null, sentAt: null, body: "c" })),
    });
    assert.equal(VERIFY_REQUEST_LIMITS.maxContextMessages, 3);
    assert.equal(verifyRequestWithinLimits(v(3)), true);
    assert.equal(verifyRequestWithinLimits(v(4)), false);
  });
});
