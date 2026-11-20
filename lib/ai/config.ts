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
 *     still required (docs/architecture/privacy-and-data-protection.md §Provider).
 *   - "omega-owner-approved": Omega Plus in production, by the owner's explicit decision of 2026-11-20 (see below).
 * Development and tests are unchanged (synthetic data only).
 *
 * R3 Task 03 (provider evaluation): `AI_PROVIDER=omega` selects the Omega Plus Anthropic-compatible gateway
 * (lib/ai/providers/omega.ts). It is accepted in exactly two ways:
 *   - EVALUATION (unchanged): NODE_ENV exactly "development" or "test" AND `BATON_ALLOW_EVAL_PROVIDER === "1"`
 *     (the operator's statement that only synthetic, pseudonymised data is processed; .env.local may point
 *     at a real database, so dev mode alone is not enough) → mode "evaluation". Checked first;
 *   - PRODUCTION, OWNER-APPROVED (2026-11-20): `AI_DATA_GOVERNANCE` (trimmed) is exactly "omega-owner-approved"
 *     → mode "production", in any NODE_ENV. The profile records that the owner ACCEPTED the vendor's
 *     undocumented retention, training-use and sub-processor terms for the public site; it is an explicit,
 *     auditable opt-in, never a default, and the uploader's consent statement says so
 *     (docs/ai/ai-extraction-and-verification.md §9a).
 *   Anything else is refused with `data_governance_unapproved` (including the Gemini profile);
 *   - `OMEGA_API_KEY` is required (server-side only); `OMEGA_API_BASE_URL` defaults to the vendor host and
 *     must be https;
 *   - `AI_MODEL_EXTRACT` and `AI_MODEL_VERIFY` are REQUIRED fixed model ids (no default), and dynamic
 *     routes (any id containing "omega", e.g. `omega-plus`, `claude-omega-ultra`) are refused;
 *   - `OMEGA_OUTPUT_MODE` = `json_schema` (default) or `prompt`;
 *   - there is no fallback to another provider.
 */

import type { Result } from "../contracts/api";
import { aiConfigChangedError, providerNotConfiguredError } from "./errors";
import type { AiProvider, AiRunConfig } from "./provider";
import { createFakeProvider, FAKE_DISPLAY_NAME, FAKE_PROVIDER_ID, fakeRunConfig } from "./providers/fake";
import { createGeminiProvider, GEMINI_DEFAULT_MODEL, GEMINI_DISPLAY_NAME, GEMINI_PROVIDER_ID, geminiRunConfig } from "./providers/gemini";
import {
  createOmegaProvider,
  OMEGA_DEFAULT_BASE_URL,
  OMEGA_EVALUATION_DISPLAY_NAME,
  OMEGA_OUTPUT_MODES,
  OMEGA_PRODUCTION_DISPLAY_NAME,
  OMEGA_PROVIDER_ID,
  omegaRunConfig,
  type OmegaOutputMode,
} from "./providers/omega";

export type AiEnv = Record<string, string | undefined>;

export type AiConfiguration =
  | { ok: true; mode: "production" | "fake" | "evaluation"; provider: { id: string; displayName: string }; runConfig: AiRunConfig }
  | { ok: false; reason: "provider_not_configured"; detail?: "data_governance_unapproved" };

/** Data-governance profiles a production deployment may declare (R3 Task 02). */
export const APPROVED_AI_DATA_GOVERNANCE: Readonly<Record<string, { provider: string; description: string }>> = Object.freeze({
  "gemini-paid-dpa": {
    provider: GEMINI_PROVIDER_ID,
    description: "Gemini API, Cloud project with active billing (Paid Services, Google Data Processing Addendum)",
  },
  "omega-owner-approved": {
    provider: OMEGA_PROVIDER_ID,
    description:
      "Omega Plus API (third-party Anthropic-compatible gateway). The owner accepted (2026-11-20) that the vendor does not document prompt retention, training use, upstream sub-processors or data location, and that model names do not guarantee the upstream model",
  },
});

/** The profile that enables Omega in production (owner decision 2026-11-20). */
export const OMEGA_OWNER_APPROVED_PROFILE = "omega-owner-approved";

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

/** R3 Task 03: a fixed Omega model id. Dynamic routes are refused: they may switch upstream models silently. */
export function omegaModel(value: string | undefined): string | null {
  if (value === undefined || !MODEL_ID.test(value) || value.includes("..")) return null;
  return /omega/i.test(value) ? null : value;
}

function omegaApiKey(env: AiEnv): string | null {
  const key = env.OMEGA_API_KEY?.trim();
  return key ? key : null;
}

/** https only, no credentials or query in the URL; unset means the vendor host. */
export function omegaBaseUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return OMEGA_DEFAULT_BASE_URL;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function omegaOutputMode(value: string | undefined): OmegaOutputMode | null {
  if (value === undefined || value.trim() === "") return "json_schema";
  return (OMEGA_OUTPUT_MODES as readonly string[]).includes(value) ? (value as OmegaOutputMode) : null;
}

/** Evaluation providers run only in development/test with the explicit synthetic-data opt-in. */
function evaluationAllowed(env: AiEnv): boolean {
  return env.NODE_ENV !== undefined && FAKE_NODE_ENVS.has(env.NODE_ENV) && env.BATON_ALLOW_EVAL_PROVIDER === "1";
}

/** Omega in production: only the exact owner-approved profile (trimmed, case-sensitive), in any NODE_ENV. */
function omegaOwnerApproved(env: AiEnv): boolean {
  return aiDataGovernanceProfile(env) === OMEGA_OWNER_APPROVED_PROFILE;
}

export function getAiConfiguration(env: AiEnv = process.env): AiConfiguration {
  if (env.AI_PROVIDER === OMEGA_PROVIDER_ID) {
    const extract = omegaModel(env.AI_MODEL_EXTRACT);
    const verify = omegaModel(env.AI_MODEL_VERIFY);
    const base = omegaBaseUrl(env.OMEGA_API_BASE_URL);
    const mode = omegaOutputMode(env.OMEGA_OUTPUT_MODE);
    if (!omegaApiKey(env) || !extract || !verify || !base || !mode) return { ok: false, reason: "provider_not_configured" };
    if (evaluationAllowed(env)) {
      return {
        ok: true,
        mode: "evaluation",
        provider: { id: OMEGA_PROVIDER_ID, displayName: OMEGA_EVALUATION_DISPLAY_NAME },
        runConfig: omegaRunConfig({ extract, verify }, mode),
      };
    }
    if (!omegaOwnerApproved(env)) return { ok: false, reason: "provider_not_configured", detail: "data_governance_unapproved" };
    return {
      ok: true,
      mode: "production",
      provider: { id: OMEGA_PROVIDER_ID, displayName: OMEGA_PRODUCTION_DISPLAY_NAME },
      // same provenance as evaluation: provider "omega", adapterVersion "omega-anthropic@2+<output mode>"
      runConfig: omegaRunConfig({ extract, verify }, mode),
    };
  }
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

/**
 * Builds the adapter by PROVIDER ID, never by mode: "production" is Gemini under `gemini-paid-dpa` OR Omega under
 * `omega-owner-approved`. getAiConfiguration has already checked the key, models, host and output mode.
 * An id it never returns throws (programming error), so an unknown provider can never fall through to another.
 */
function providerFor(config: Extract<AiConfiguration, { ok: true }>, env: AiEnv): AiProvider {
  switch (config.provider.id) {
    case FAKE_PROVIDER_ID:
      return createFakeProvider();
    case OMEGA_PROVIDER_ID:
      return createOmegaProvider({
        apiKey: omegaApiKey(env) as string,
        baseUrl: omegaBaseUrl(env.OMEGA_API_BASE_URL) as string,
        models: { extract: config.runConfig.extract.model, verify: config.runConfig.verify.model },
        outputMode: omegaOutputMode(env.OMEGA_OUTPUT_MODE) as OmegaOutputMode,
        displayName: config.provider.displayName,
      });
    case GEMINI_PROVIDER_ID:
      return createGeminiProvider({
        apiKey: geminiApiKey(env) as string,
        models: { extract: config.runConfig.extract.model, verify: config.runConfig.verify.model },
      });
    default:
      throw new Error("unknown AI provider id");
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

/** The declared data-governance profile name (R3 Task 02), trimmed; "" when none. A name, never a secret. */
export function aiDataGovernanceProfile(env: AiEnv = process.env): string {
  return (env.AI_DATA_GOVERNANCE ?? "").trim();
}
