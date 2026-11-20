/**
 * The consent checklist's state (pure, React-free so processing-controls tests can use the real rules). Re-exported
 * by consent.tsx, which renders the checklist.
 */
export const CONSENT_ITEM_IDS = ["informed", "provider", "optout"] as const;
export type ConsentItemId = (typeof CONSENT_ITEM_IDS)[number];

export const emptyConsent = (): Record<ConsentItemId, boolean> => ({ informed: false, provider: false, optout: false });
export const consentComplete = (v: Record<ConsentItemId, boolean>) => CONSENT_ITEM_IDS.every((id) => v[id]);

/**
 * Round 4 audit A3 / F6: the ticks survive a reload of the consent step as DRAFT UI state only. They are kept in
 * sessionStorage (this tab, this draft) and never sent anywhere: consent is recorded on the server only when a
 * source is uploaded with the full checklist ticked, exactly as before.
 */
export const consentDraftKey = (handoverId: string) => `baton:wizard-consent:${handoverId}`;

export function parseConsentDraft(raw: string | null): Record<ConsentItemId, boolean> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const out = emptyConsent();
    for (const id of CONSENT_ITEM_IDS) out[id] = (v as Record<string, unknown>)[id] === true;
    return CONSENT_ITEM_IDS.some((id) => out[id]) ? out : null;
  } catch {
    return null;
  }
}

export function serializeConsentDraft(v: Record<ConsentItemId, boolean>): string | null {
  return CONSENT_ITEM_IDS.some((id) => v[id]) ? JSON.stringify(Object.fromEntries(CONSENT_ITEM_IDS.map((id) => [id, v[id] === true]))) : null;
}
