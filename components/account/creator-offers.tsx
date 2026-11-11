"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Crown, X } from "lucide-react";
import { useState } from "react";

import { formatDate } from "@/components/handover/format";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import type { CreatorTransferOffer } from "@/lib/contracts/dto";
import { respondToCreatorTransfer } from "@/lib/actions/handovers";
import { routes } from "@/lib/routes";

/** Creatorship offers addressed to the signed-in user (§12.9, `listMyCreatorTransferOffers`). */
export function CreatorOffers({ offers }: { offers: CreatorTransferOffer[] }) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const [busy, setBusy] = useState<string | null>(null);

  async function respond(offer: CreatorTransferOffer, accept: boolean) {
    setBusy(offer.handoverId);
    const r = await run(() => respondToCreatorTransfer({ handoverId: offer.handoverId, accept }), {
      success: accept ? `You're now the creator of ${offer.handoverTitle}` : "Offer declined",
    });
    setBusy(null);
    if (r.ok && accept) router.push(routes.handover.settings(offer.handoverId));
  }

  return (
    <section aria-labelledby="offers-heading" className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-soft sm:p-6">
      <div className="space-y-1">
        <h2 id="offers-heading" className="text-base font-semibold">
          Creatorship offers
        </h2>
        <p className="text-sm text-muted-foreground">
          The creator publishes the handover, invites people and can delete it. Nobody becomes creator without accepting.
        </p>
      </div>
      {offers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No offers are waiting for you.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {offers.map((o) => (
            <li key={o.handoverId} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
              <Crown aria-hidden="true" className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <Link href={routes.handover.settings(o.handoverId)} className="hover:underline">
                    {o.handoverTitle}
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground">
                  Offered by {o.offeredByLabel} on {formatDate(o.offeredAt)}. Offers lapse after 14 days.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => respond(o, false)} aria-label={`Decline creatorship of ${o.handoverTitle}`}>
                  <X aria-hidden="true" data-icon="inline-start" />
                  Decline
                </Button>
                <Button size="sm" disabled={isPending} aria-busy={busy === o.handoverId} onClick={() => respond(o, true)} aria-label={`Accept creatorship of ${o.handoverTitle}`}>
                  <Check aria-hidden="true" data-icon="inline-start" />
                  {busy === o.handoverId ? "Saving…" : "Accept"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
