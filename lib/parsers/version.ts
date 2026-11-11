/**
 * Semver of the parser module, reported as `ParsedSource.parserVersion` and in every `ParseContext`
 * (§11.4). It identifies parser BEHAVIOUR: a conversation exclusion chosen under one version is
 * rejected under another (`exclusion_context_mismatch`, D32). Bump it whenever output can change
 * for the same input.
 *
 * History:
 *  - 1.0.0: initial parser (pre-Revision 8 output shape).
 *  - 1.1.0: Revision 8. Identity normalization per §12.11 (trunk zero after +91 removed before any
 *           10 digits, no default region), identity kind and pepper version on participants,
 *           apply/detect participant rules, parse context, identity matches, preview applies
 *           exclusions, warnings never point at excluded lines.
 */
export const PARSER_VERSION = "1.1.0";
