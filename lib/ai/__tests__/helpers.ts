// Shared synthetic data for lib/ai tests. Everything here is invented.
import type { AiRunConfig, ExtractRequest, VerifySupportRequest } from "../provider";
import { fakeRunConfig } from "../providers/fake";

export const ID = {
  m1: "a0000000-0000-4000-8000-000000000001",
  m2: "a0000000-0000-4000-8000-000000000002",
  m3: "a0000000-0000-4000-8000-000000000003",
  foreign: "a0000000-0000-4000-8000-0000000000ff",
} as const;

export const BODY = {
  m1: "We decided to hold the inter-college fest on 14 March. Ravi handles the sponsor list.",
  m2: "Asha said: “Pay the hall deposit to [UPI_1] before Friday — it is non-refundable.”",
  m3: "The faculty advisor still has not signed the permission letter, so we are blocked.",
} as const;

export function extractRequest(overrides: Partial<ExtractRequest> = {}): ExtractRequest {
  return {
    handover: { teamName: "Synthetic Debate Society", roleTitle: "Treasurer" },
    categories: ["decision", "owner", "open_task", "blocker", "risk", "dependency", "recurring_problem", "contact", "next_action", "account_access"],
    messages: [
      { id: ID.m1, authorLabel: "Asha (Treasurer)", sentAt: "2026-01-05T10:00:00Z", body: BODY.m1 },
      { id: ID.m2, authorLabel: "Ravi", sentAt: "2026-01-06T09:30:00Z", body: BODY.m2 },
      { id: ID.m3, authorLabel: null, sentAt: null, body: BODY.m3 },
    ],
    ...overrides,
  };
}

export function verifyRequest(overrides: Partial<VerifySupportRequest> = {}): VerifySupportRequest {
  return {
    claim: {
      category: "decision",
      title: "Fest date",
      statement: "The inter-college fest will be held on 14 March",
      attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    },
    quote: { text: "We decided to hold the inter-college fest on 14 March", authorLabel: "Asha (Treasurer)", sentAt: null },
    context: [{ authorLabel: "Ravi", sentAt: null, body: "Great, I will tell the sponsors." }],
    ...overrides,
  };
}

export const runConfig = (): AiRunConfig => fakeRunConfig();

/** A candidate in the model's output format. */
export function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: "decision",
    title: "Fest on 14 March",
    statement: "The inter-college fest will be held on 14 March.",
    attributes: {},
    citations: [{ messageId: ID.m1, quote: "We decided to hold the inter-college fest on 14 March", stance: "supports" }],
    inferenceRationale: null,
    ...overrides,
  };
}
