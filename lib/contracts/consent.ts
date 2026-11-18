/**
 * What the consent checklist tells the uploader about AI processing (R3 Task 05D). Shared by the server (which
 * decides it from the ACTUAL configuration, lib/ai/consent-disclosure.ts) and the client (which renders it).
 *
 * The wording must describe the execution environment truthfully:
 *   - local_test     the deterministic test adapter (AI_PROVIDER=fake, development/test only): nothing is sent to
 *                    any AI provider, so naming Gemini would be false;
 *   - gemini_free    the Gemini Developer API without a paid data-governance profile (development only);
 *   - gemini_paid    the Gemini API under the approved "gemini-paid-dpa" profile;
 *   - evaluation     an evaluation-only provider (synthetic data only);
 *   - not_configured no provider: processing cannot start (the server refuses consent too).
 * It names a provider only by its public display name; it never carries a key, a URL or any other secret.
 * Each wording has its own statement version, recorded with the consent.
 */

export const CONSENT_DISCLOSURE_KINDS = ["local_test", "gemini_free", "gemini_paid", "evaluation", "not_configured"] as const;
export type ConsentDisclosureKind = (typeof CONSENT_DISCLOSURE_KINDS)[number];

export interface ConsentDisclosure {
  kind: ConsentDisclosureKind;
  /** The provider as the uploader should know it, or a plain statement that there is none. */
  providerLabel: string;
  /** Short badge above the provider statement. */
  badge: string;
  /** The checklist statement about AI processing. */
  providerStatement: string;
  /** Version of this exact wording; recorded with each source's consent. */
  statementVersion: string;
}

export const GEMINI_FREE_LABEL = "Google Gemini (Gemini Developer API, free tier)";
export const GEMINI_PAID_LABEL = "Google Gemini (Gemini API, paid tier under Google's Data Processing Addendum)";

const MASKING = "Phone numbers, emails, payment details and secrets are masked before anything is sent.";

export function consentDisclosure(kind: ConsentDisclosureKind, providerName?: string): ConsentDisclosure {
  switch (kind) {
    case "local_test":
      return {
        kind,
        providerLabel: "No AI provider (local test adapter)",
        badge: "Local test · no AI provider",
        providerStatement:
          "I understand this is a local test environment: Baton's built-in test adapter stands in for the AI, so no content is sent to any AI provider. Phone numbers, emails, payment details and secrets are still masked, and the raw file is still deleted after processing.",
        statementVersion: "local-test-2026-11-18-v1",
      };
    case "gemini_free":
      return {
        kind,
        providerLabel: GEMINI_FREE_LABEL,
        badge: "AI provider · free tier",
        providerStatement: `I understand masked content will be sent to ${GEMINI_FREE_LABEL} for processing. ${MASKING} On the free tier, Google may use this content to improve its products, which can include review by people, so do not upload anything you would not share with Google. The raw file is deleted after processing.`,
        // unchanged from D11 (2026-11-14): this is the wording consent was recorded with before Task 05D
        statementVersion: "gemini-free-2026-11-14-v1",
      };
    case "gemini_paid":
      return {
        kind,
        providerLabel: GEMINI_PAID_LABEL,
        badge: "AI provider · paid tier",
        providerStatement: `I understand masked content will be sent to ${GEMINI_PAID_LABEL} for processing. ${MASKING} Google does not use it to improve its products, and may keep prompts and responses for a limited period for abuse monitoring. The raw file is deleted after processing.`,
        statementVersion: "gemini-paid-dpa-2026-11-18-v1",
      };
    case "evaluation": {
      const name = providerName && providerName.trim() ? providerName.trim() : "an evaluation AI provider";
      return {
        kind,
        providerLabel: name,
        badge: "Evaluation provider · synthetic data only",
        providerStatement: `I understand masked content will be sent to ${name} for processing. This provider is for evaluation only: upload synthetic test data only. ${MASKING} The raw file is deleted after processing.`,
        statementVersion: "evaluation-2026-11-18-v1",
      };
    }
    case "not_configured":
      return {
        kind,
        providerLabel: "No AI provider configured",
        badge: "No AI provider configured",
        providerStatement:
          "No AI provider is configured on this server, so processing can't start yet. Nothing will be sent anywhere until an administrator configures one and you confirm consent again.",
        statementVersion: "not-configured-2026-11-18-v1",
      };
  }
}

/** The provider id (AiRunConfig.provider) each wording describes; null when there is none. */
export function disclosureProviderId(kind: ConsentDisclosureKind): string | null {
  switch (kind) {
    case "local_test":
      return "fake";
    case "gemini_free":
    case "gemini_paid":
      return "gemini";
    case "evaluation":
      return "omega";
    case "not_configured":
      return null;
  }
}

/** Refusal when the submitted consent statement is not the wording this server currently shows (R3 Task 05E). */
export const CONSENT_STATEMENT_OUTDATED_REASON = "consent_statement_outdated";
export const CONSENT_STATEMENT_OUTDATED_MESSAGE =
  "The statement about AI processing has changed. Reload the page, read the updated wording and confirm it again.";
