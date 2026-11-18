import "server-only";

/**
 * R3 Task 05D: the consent wording for THIS server's actual AI configuration (lib/contracts/consent.ts). Uses only
 * what getAiConfiguration decides (mode and provider id) plus the data-governance profile NAME; never an API key,
 * URL or other secret. The local fake adapter is never presented as Gemini, and Gemini is never claimed merely
 * because it is the historical default.
 *
 * R3 Task 06: this module DEFINES the function (it used to be a bare `export { getConsentDisclosure } from
 * "./config"`). Turbopack rewrites an import of a pure re-export barrel into a direct binding on the target
 * module, and a long-running dev server that had compiled config.ts before the function was added bound the
 * New Handover page to that stale module: "{imported module ./lib/ai/config.ts}.getConsentDisclosure is not a
 * function" on the first render of /handover/new. Every caller (pages and lib/actions/deps.ts) imports it from
 * here, so the binding is always to the module that owns the code. Wording and statement versions are unchanged.
 */

import { consentDisclosure, type ConsentDisclosure } from "../contracts/consent";
import { aiDataGovernanceProfile, getAiConfiguration, type AiEnv } from "./config";
import { GEMINI_PROVIDER_ID } from "./providers/gemini";

/** `env` defaults to the server environment (read only by config.ts, the env reader). */
export function getConsentDisclosure(env?: AiEnv): ConsentDisclosure {
  const config = getAiConfiguration(env);
  if (!config.ok) return consentDisclosure("not_configured");
  switch (config.mode) {
    case "fake":
      return consentDisclosure("local_test");
    case "evaluation":
      return consentDisclosure("evaluation", config.provider.displayName);
    case "production":
      if (config.provider.id !== GEMINI_PROVIDER_ID) return consentDisclosure("not_configured");
      // the paid tier only under the approved profile; otherwise (development with a key) it is the free tier
      return aiDataGovernanceProfile(env) === "gemini-paid-dpa" ? consentDisclosure("gemini_paid") : consentDisclosure("gemini_free");
  }
}
