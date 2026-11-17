import "server-only";

/**
 * AI configuration (§11.8, §12.5, D11). The ONLY reader of AI environment variables.
 *
 * D11 (2026-11-14): the production provider is the Google Gemini Developer API (free tier).
 * - `AI_PROVIDER=gemini` → production mode, only when `AI_API_KEY` is set. `AI_MODEL_EXTRACT` /
 *   `AI_MODEL_VERIFY` default to `gemini-3.6-flash`; a value that is not a plain model id refuses.
 * - "fake" is accepted only when `NODE_ENV` is exactly "development" or "test" AND
 *   `BATON_ALLOW_FAKE_AI === "1"` (QA-L3). An unset, empty, "production" or any other `NODE_ENV`
 *   (e.g. a custom server or script started without it) refuses the fake: fail closed.
 * - Anything else (unset, empty, unknown) → `provider_not_configured`, never a guess.
 * The API key is read only when the provider is built (`providerFor`) and is passed straight to the
 * adapter: it is never part of `AiConfiguration`, `AiRunConfig`, provenance or errors.
 * No AI variable has a `NEXT_PUBLIC_` prefix.
 *
 * R3 Task 02 (PRIV-1, JOB-2): data governance. Any build that is not exactly NODE_ENV "development" or "test"
 * (every Vercel deployment, `next start`, a script started without NODE_ENV) runs a real provider ONLY with an explicit, approved data-governance profile in
 * `AI_DATA_GOVERNANCE`. Without it the configuration is `provider_not_configured`, so production can never
 * fall back silently to the Gemini free tier, whose terms allow Google to use content to improve its products
 * with human review and say not to submit personal information. Profiles (APPROVED_AI_DATA_GOVERNANCE):
 *   - "gemini-paid-dpa": the Gemini API through a Cloud project with an ACTIVE billing account ("Paid
 *     Services": no use of prompts or responses to improve Google products; processing under Google's Data
 *     Processing Addendum; prompts and responses still logged for a limited period for abuse monitoring).
 *     Setting it is the operator's attestation that the key belongs to such a project. Owner approval is
 *     still required (docs/round3/privacy-and-data-protection.md §Provider).
 * Development and tests are unchanged (synthetic data only).
 */

import type { Result } from "../contracts/api";
import { aiConfigChangedError, providerNotConfiguredError } from "./errors";
import type { AiProvider, AiRunConfig } from "./provider";
import { createFakeProvider, FAKE_DISPLAY_NAME, FAKE_PROVIDER_ID, fakeRunConfig } from "./providers/fake";
import { createGeminiProvider, GEMINI_DEFAULT_MODEL, GEMINI_DISPLAY_NAME, GEMINI_PROVIDER_ID, geminiRunConfig } from "./providers/gemini";

export type AiEnv = Record<string, string | undefined>;

export type AiConfiguration =
  | { ok: true; mode: "production" | "fake"; provider: { id: string; displayName: string }; runConfig: AiRunConfig }
  | { ok: false; reason: "provider_not_configured"; detail?: "data_governance_unapproved" };

/** Data-governance profiles a production deployment may declare (R3 Task 02). */
export const APPROVED_AI_DATA_GOVERNANCE: Readonly<Record<string, { provider: string; description: string }>> = Object.freeze({
  "gemini-paid-dpa": {
    provider: GEMINI_PROVIDER_ID,
    description: "Gemini API, Cloud project with active billing (Paid Services, Google Data Processing Addendum)",
  },
});

/** True when this environment may call a real provider with organisational data. */
export function dataGovernanceApproved(env: AiEnv, provider: string): boolean {
  // Only exact "development" / "test" skip the gate (synthetic data only); unset or anything else is production.
  if (env.NODE_ENV !== undefined && FAKE_NODE_ENVS.has(env.NODE_ENV)) return true;
  const profile = APPROVED_AI_DATA_GOVERNANCE[(env.AI_DATA_GOVERNANCE ?? "").trim()];
  return profile !== undefined && profile.provider === provider;
}

/** NODE_ENV values under which the test adapter may run. Exact match: no trimming, case-sensitive. */
const FAKE_NODE_ENVS: ReadonlySet<string> = new Set(["development", "test"]);

function fakeAllowed(env: AiEnv): boolean {
  return env.NODE_ENV !== undefined && FAKE_NODE_ENVS.has(env.NODE_ENV) && env.BATON_ALLOW_FAKE_AI === "1";
}

/** A plain model id ("gemini-3.6-flash"); unset or empty means the default. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

function geminiModel(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return GEMINI_DEFAULT_MODEL;
  // ".." is refused because @google/genai throws a plain Error for it on every call (tModel), which would
  // surface as a retryable network failure instead of a configuration error.
  return MODEL_ID.test(value) && !value.includes("..") ? value : null;
}

function geminiApiKey(env: AiEnv): string | null {
  const key = env.AI_API_KEY?.trim();
  return key ? key : null;
}

export function getAiConfiguration(env: AiEnv = process.env): AiConfiguration {
  if (env.AI_PROVIDER === GEMINI_PROVIDER_ID) {
    const extract = geminiModel(env.AI_MODEL_EXTRACT);
    const verify = geminiModel(env.AI_MODEL_VERIFY);
    if (!geminiApiKey(env) || !extract || !verify) return { ok: false, reason: "provider_not_configured" };
    if (!dataGovernanceApproved(env, GEMINI_PROVIDER_ID)) {
      return { ok: false, reason: "provider_not_configured", detail: "data_governance_unapproved" };
    }
    return {
      ok: true,
      mode: "production",
      provider: { id: GEMINI_PROVIDER_ID, displayName: GEMINI_DISPLAY_NAME },
      runConfig: geminiRunConfig({ extract, verify }),
    };
  }
  if (env.AI_PROVIDER === FAKE_PROVIDER_ID && fakeAllowed(env)) {
    return {
      ok: true,
      mode: "fake",
      provider: { id: FAKE_PROVIDER_ID, displayName: FAKE_DISPLAY_NAME },
      runConfig: fakeRunConfig(),
    };
  }
  // Any other value is "not configured", never a guess.
  return { ok: false, reason: "provider_not_configured" };
}

/** The configured provider, or `precondition_failed` with `details.reason = "provider_not_configured"` (not retryable). */
export function getAiProvider(env: AiEnv = process.env): Result<AiProvider> {
  const config = getAiConfiguration(env);
  if (!config.ok) return { ok: false, error: providerNotConfiguredError() };
  return { ok: true, data: providerFor(config, env) };
}

/**
 * The provider for a run whose `AiRunConfig` was snapshotted at run creation (§11.8 rule 3). Fails with
 * `provider_not_configured`, or with `precondition_failed` / `details.reason = "ai_config_changed"` when
 * the live configuration differs from the snapshot in any field. Neither is retryable.
 * On success `provider.id === runConfig.provider` is guaranteed.
 */
export function getAiProviderForRun(runConfig: AiRunConfig, env: AiEnv = process.env): Result<AiProvider> {
  const config = getAiConfiguration(env);
  if (!config.ok) return { ok: false, error: providerNotConfiguredError() };
  if (!sameRunConfig(config.runConfig, runConfig)) return { ok: false, error: aiConfigChangedError() };
  const provider = providerFor(config, env);
  if (provider.id !== runConfig.provider) return { ok: false, error: aiConfigChangedError() };
  return { ok: true, data: provider };
}

function providerFor(config: Extract<AiConfiguration, { ok: true }>, env: AiEnv): AiProvider {
  switch (config.mode) {
    case "fake":
      return createFakeProvider();
    case "production":
      // getAiConfiguration returns production mode only for Gemini with a key present.
      return createGeminiProvider({
        apiKey: geminiApiKey(env) as string,
        models: { extract: config.runConfig.extract.model, verify: config.runConfig.verify.model },
      });
  }
}

function sameRunConfig(a: AiRunConfig, b: AiRunConfig): boolean {
  if (typeof b !== "object" || b === null || typeof b.extract !== "object" || typeof b.verify !== "object") return false;
  return (
    a.provider === b.provider &&
    a.adapterVersion === b.adapterVersion &&
    a.extract.model === b.extract?.model &&
    a.extract.promptVersion === b.extract?.promptVersion &&
    a.extract.schemaVersion === b.extract?.schemaVersion &&
    a.verify.model === b.verify?.model &&
    a.verify.promptVersion === b.verify?.promptVersion &&
    a.verify.schemaVersion === b.verify?.schemaVersion
  );
}
