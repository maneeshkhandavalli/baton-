import "server-only";

/**
 * Prompt and output-schema versions (§11.8 provenance, §12.10 rule 1).
 *
 * Bump the prompt version on ANY change to the instruction text in lib/ai/prompts/*, and the schema
 * version on any change to the output schema the call is parsed with (lib/contracts/schemas.ts
 * extraction/support schemas). A bump changes `AiRunConfig` and therefore `input_hash`, so stages re-run.
 * The prompt-injection suite (fixtures/ai/prompt-injection) must pass before any bump (§11.8 rule 7).
 */

export const EXTRACT_PROMPT_VERSION = "extract@1";
export const SUPPORT_PROMPT_VERSION = "support@1";

export const EXTRACT_SCHEMA_VERSION = "extraction@1";
export const SUPPORT_SCHEMA_VERSION = "support-verdict@1";
