/**
 * Prototype-only feature switches (Round 2 demo). Everything gated here is DEMO functionality:
 *   - "Use sample data" on the wizard's Sources step,
 *   - "Fill with sample data" in the review workspace's sections.
 *
 * To disable before production, set NEXT_PUBLIC_BATON_SAMPLE_DATA=off in the deployment environment
 * (it is inlined at build time), or change the default below to `false`. Nothing in the product depends
 * on sample data: the fixtures are only loaded on demand when a user clicks one of these actions.
 */
export const SAMPLE_DATA_ENABLED: boolean = process.env.NEXT_PUBLIC_BATON_SAMPLE_DATA !== "off";
