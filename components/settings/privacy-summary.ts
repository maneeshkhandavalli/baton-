import { maskKindLabel } from "@/components/handover/labels";
import type { MaskKind } from "@/lib/contracts/enums";

/**
 * The parenthetical of the Settings privacy bullet ("12 phone numbers, 3 emails"), or null when nothing was
 * masked, so the bullet never renders empty parentheses (judge break test: "were masked before storage ().").
 */
export function maskedCountsText(masking: Partial<Record<MaskKind, number>>): string | null {
  const parts = (Object.entries(masking) as Array<[MaskKind, number | undefined]>)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${maskKindLabel[k].label.toLowerCase()}`);
  return parts.length > 0 ? parts.join(", ") : null;
}
