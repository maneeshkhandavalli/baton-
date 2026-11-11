import "server-only";

/**
 * AI configuration (§11.8, §12.5, D11). The ONLY reader of AI environment variables.
 *
 * D11 is open: no production provider or model has been chosen, so there is no production adapter.
 * - `AI_PROVIDER` unset, empty, or anything other than exactly "fake" → `provider_not_configured`.
 * - "fake" is accepted only when `NODE_ENV !== "production"` AND `BATON_ALLOW_FAKE_AI === "1"`.
 * `AI_API_KEY`, `AI_MODEL_EXTRACT` and `AI_MODEL_VERIFY` are reserved for a future adapter and are not
 * read today: the fake adapter needs no credentials and always reports its own fake model ids.
 * No AI variable has a `NEXT_PUBLIC_` prefix.
 */

import type { Result } from "../contracts/api";
import { aiConfigChangedError, providerNotConfiguredError } from "./errors";
import type { AiProvider, AiRunConfig } from "./provider";
import { createFakeProvider, FAKE_DISPLAY_NAME, FAKE_PROVIDER_ID, fakeRunConfig } from "./providers/fake";

export type AiEnv = Record<string, string | undefined>;

export type AiConfiguration =
  | { ok: true; mode: "production" | "fake"; provider: { id: string; displayName: string }; runConfig: AiRunConfig }
  | { ok: false; reason: "provider_not_configured" };

function fakeAllowed(env: AiEnv): boolean {
  return env.NODE_ENV !== "production" && env.BATON_ALLOW_FAKE_AI === "1";
}

export function getAiConfiguration(env: AiEnv = process.env): AiConfiguration {
  if (env.AI_PROVIDER === FAKE_PROVIDER_ID && fakeAllowed(env)) {
    return {
      ok: true,
      mode: "fake",
      provider: { id: FAKE_PROVIDER_ID, displayName: FAKE_DISPLAY_NAME },
      runConfig: fakeRunConfig(),
    };
  }
  // D11 open: no production adapter exists. Any other value is "not configured", never a guess.
  return { ok: false, reason: "provider_not_configured" };
}

/** The configured provider, or `precondition_failed` with `details.reason = "provider_not_configured"` (not retryable). */
export function getAiProvider(env: AiEnv = process.env): Result<AiProvider> {
  const config = getAiConfiguration(env);
  if (!config.ok) return { ok: false, error: providerNotConfiguredError() };
  return { ok: true, data: providerFor(config) };
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
  const provider = providerFor(config);
  if (provider.id !== runConfig.provider) return { ok: false, error: aiConfigChangedError() };
  return { ok: true, data: provider };
}

function providerFor(config: Extract<AiConfiguration, { ok: true }>): AiProvider {
  switch (config.mode) {
    case "fake":
      return createFakeProvider();
    case "production":
      // Unreachable while D11 is open: getAiConfiguration never returns production mode.
      throw new Error("no production AI adapter exists (D11 open)");
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
