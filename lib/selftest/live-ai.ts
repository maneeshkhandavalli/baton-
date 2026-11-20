import "server-only";

/**
 * The opt-in live AI check for /test: ONE tiny synthetic support verification through the real configured
 * provider path (getAiConfiguration → getAiProvider → verifySupport). No real data is ever sent: the claim and
 * quote below are fixed and synthetic. A cooldown refuses a second run within LIVE_AI_COOLDOWN_MS on the same
 * server instance (the Server Action also keeps a cookie, so a fresh instance does not reset it for the owner).
 */

import { getAiConfiguration, getAiProvider } from "../ai/config";
import type { VerifySupportRequest } from "../ai/provider";
import { verifySupport } from "../ai/verify-support";

export const LIVE_AI_COOLDOWN_MS = 60_000;
const LIVE_AI_TIMEOUT_MS = 45_000;

/** Fixed synthetic pair: no person, no organisation, no real content. */
export const SYNTHETIC_VERIFY_REQUEST: VerifySupportRequest = {
  claim: {
    category: "decision",
    title: "Synthetic self-check",
    statement: "The team chose blue for the test banner.",
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
  },
  quote: { text: "We agreed to use blue for the test banner.", authorLabel: "[PERSON_1]", sentAt: null },
  context: [],
};

export interface LiveAiResult {
  ok: boolean;
  message: string;
  provider?: string;
  displayName?: string;
  requestedModel?: string;
  reportedModel?: string | null;
  verdict?: string;
  latencyMs?: number;
  ranAt: string;
}

let lastRunAt = 0;

/** Seconds left on the cooldown given the last run time (0 when free). */
export function cooldownLeftSeconds(last: number, now: number): number {
  const left = last + LIVE_AI_COOLDOWN_MS - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export async function runLiveAiCheck(lastRunFromCookie: number, now: number = Date.now()): Promise<LiveAiResult> {
  const ranAt = new Date(now).toISOString();
  const wait = cooldownLeftSeconds(Math.max(lastRunAt, Number.isFinite(lastRunFromCookie) ? lastRunFromCookie : 0), now);
  if (wait > 0) return { ok: false, message: `Cooldown: try again in ${wait} s.`, ranAt };

  const config = getAiConfiguration();
  if (!config.ok) return { ok: false, message: "The AI provider is not configured on this deployment.", ranAt };
  const provider = getAiProvider();
  if (!provider.ok) return { ok: false, message: "The AI provider is not configured on this deployment.", ranAt };

  lastRunAt = now;
  const started = Date.now();
  let result;
  try {
    result = await verifySupport(provider.data, SYNTHETIC_VERIFY_REQUEST, {
      attempt: 1,
      runConfig: config.runConfig,
      signal: AbortSignal.timeout(LIVE_AI_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, message: "The call threw before an answer (network or timeout).", provider: config.provider.id, displayName: config.provider.displayName, requestedModel: config.runConfig.verify.model, latencyMs: Date.now() - started, ranAt };
  }
  const latencyMs = Date.now() - started;
  const base = { provider: config.provider.id, displayName: config.provider.displayName, requestedModel: config.runConfig.verify.model, ranAt };
  if (!result.ok) {
    const reason = (result.error.details as { reason?: unknown } | undefined)?.reason;
    return {
      ...base,
      ok: false,
      message: `The provider call failed (${result.error.code}${typeof reason === "string" ? `, ${reason.slice(0, 40)}` : ""}${result.attempt?.httpStatus ? `, HTTP ${result.attempt.httpStatus}` : ""}).`,
      reportedModel: result.provenance?.model ?? null,
      latencyMs: result.attempt?.latencyMs ?? latencyMs,
    };
  }
  return {
    ...base,
    ok: true,
    message: "The provider answered with a valid verdict.",
    reportedModel: result.data.provenance.model,
    verdict: result.data.verdict,
    latencyMs: result.data.attempt.latencyMs ?? latencyMs,
  };
}
