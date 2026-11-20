"use client";


import { useState } from "react";

import { formatDate } from "@/components/handover/format";
import { accessLevelMeta, memberRoleLabel, tokenStatusDetail, tokenStatusMeta } from "@/components/handover/labels";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import type { AccessTokenSummary, CreatedInvitation } from "@/lib/contracts/dto";
import { revokeAccessToken } from "@/lib/actions/gaps";
import { reissueInvitation } from "@/lib/actions/invitations";

import { canReissue, deliveryStatusLabel, inviteErrorMessage } from "./invite-delivery";
import { InviteResult } from "./invite-result";
import { cn } from "@/lib/utils";

/** Exactly the canonical derived status; nothing else is inferred from the token. */
function StatusPill({ token }: { token: AccessTokenSummary }) {
  const meta = tokenStatusMeta[token.status];
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-2xs font-medium", meta.className)}>{meta.label}</span>;
}

/**
 * Invitations and Gap Interview links (§12.4, `listAccessTokens`). The raw token is never listed, so a
 * lost link can only be revoked and created again. Review roles see Gap Interview links; only the
 * creator sees invitations and who they were sent to.
 */
export function AccessLinks({ tokens, creator }: { tokens: AccessTokenSummary[]; creator: boolean }) {
  const { run } = useAction();
  // R3 Task 06 (contract §3.2 item 4, §4.3): a reissued invitation's one-time link and delivery, by the OLD row's id
  const [reissued, setReissued] = useState<Record<string, CreatedInvitation>>({});
  const [reissueError, setReissueError] = useState<Record<string, string>>({});
  const invites = tokens.filter((t) => t.purpose === "member_invite");
  const gapLinks = tokens.filter((t) => t.purpose === "gap_interview");
  const pendingInvites = invites.filter((t) => t.status === "active");

  const revoke = (t: AccessTokenSummary, label: string) => (
    <ConfirmDialog
      trigger={
        <Button size="xs" variant="ghost" className="max-sm:h-10" aria-label={`Revoke ${label}`}>
          Revoke
        </Button>
      }
      title="Revoke this link?"
      description="It stops working straight away. Anyone who already joined or answered keeps their access and answers."
      confirmLabel="Revoke"
      destructive
      onConfirm={async () => {
        await run(() => revokeAccessToken({ tokenId: t.id }), { success: "Link revoked" });
      }}
    />
  );

  const reissue = (t: AccessTokenSummary) => (
    <ConfirmDialog
      trigger={
        <Button size="xs" variant="ghost" className="max-sm:h-10" aria-label={`Send a new link to ${t.recipientEmail ?? "this person"}`}>
          Send a new link
        </Button>
      }
      title="Send a new invitation link?"
      description="The current link stops working and a new one replaces it, with the same address, role and access. If email is set up, Baton emails it."
      confirmLabel="Send a new link"
      onConfirm={async () => {
        setReissueError((m) => ({ ...m, [t.id]: "" }));
        await run(() => reissueInvitation({ tokenId: t.id }), {
          success: (d) => (d.delivery.status === "sent" ? "New invitation emailed" : "New invitation link created"),
          onSuccess: (d) => setReissued((m) => ({ ...m, [t.id]: d })),
          onError: (err) => {
            setReissueError((m) => ({ ...m, [t.id]: inviteErrorMessage(err) }));
            return true;
          },
        });
      }}
    />
  );

  return (
    <div className="space-y-5">
      {creator && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Invitations <span className="font-normal text-muted-foreground">· {pendingInvites.length} waiting</span>
          </h3>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invitations yet.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {invites.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.recipientEmail ?? "Invitation"}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.grantRole ? memberRoleLabel[t.grantRole] : "Member"} · sees {accessLevelMeta[t.maxAccessLevel].label.toLowerCase()} · {tokenStatusDetail(t, formatDate)}
                      {deliveryStatusLabel(t.deliveryStatus) && ` · ${deliveryStatusLabel(t.deliveryStatus)}`}
                    </p>
                  </div>
                  <StatusPill token={t} />
                  {canReissue(t) && !reissued[t.id] && reissue(t)}
                  {t.status === "active" && !reissued[t.id] && revoke(t, `the invitation for ${t.recipientEmail ?? "this person"}`)}
                  {reissueError[t.id] && (
                    <p role="alert" className="w-full text-caption font-medium text-destructive-fg">
                      {reissueError[t.id]}
                    </p>
                  )}
                  {reissued[t.id] && <InviteResult className="w-full" invitation={reissued[t.id]} email={t.recipientEmail} />}
                </li>
              ))}
            </ul>
          )}
          {pendingInvites.length > 0 && (
            <p className="text-xs text-muted-foreground">People appear under members once they sign in with the invited address.</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Gap Interview links</h3>
        {gapLinks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No links yet. Create one on the Gaps page.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {gapLinks.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Link created {formatDate(t.createdAt)}</p>
                  <p className="text-xs text-muted-foreground">
                    Up to {accessLevelMeta[t.maxAccessLevel].label.toLowerCase()} · {tokenStatusDetail(t, formatDate)}
                  </p>
                </div>
                <StatusPill token={t} />
                {t.status === "active" && revoke(t, `Gap Interview link ${i + 1}`)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
