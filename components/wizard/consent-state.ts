/**
 * The consent checklist's state (pure, React-free so processing-controls tests can use the real rules). Re-exported
 * by consent.tsx, which renders the checklist.
 */
export const CONSENT_ITEM_IDS = ["informed", "provider", "optout"] as const;
export type ConsentItemId = (typeof CONSENT_ITEM_IDS)[number];

export const emptyConsent = (): Record<ConsentItemId, boolean> => ({ informed: false, provider: false, optout: false });
export const consentComplete = (v: Record<ConsentItemId, boolean>) => CONSENT_ITEM_IDS.every((id) => v[id]);
