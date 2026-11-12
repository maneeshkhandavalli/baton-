"use client";

import { Link2, Mail } from "lucide-react";

import { formatDate } from "@/components/handover/format";
import { accessLevelMeta, memberRoleLabel, tokenStatusDetail, tokenStatusMeta } from "@/components/handover/labels";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import type { AccessTokenSummary } from "@/lib/contracts/dto";
import { revokeAccessToken } from "@/lib/actions/gaps";
import { cn } from "@/lib/utils";

/** Exactly the canonical derived status; nothing else is inferred from the token. */
function StatusPill({ token }: { token: AccessTokenSummary }) {
  const meta = tokenStatusMeta[token.status];
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[0.6875rem] font-medium", meta.className)}>{meta.label}</span>;
}

/**
 * Invitations and Gap Interview links (§12.4, `listAccessTokens`). The raw token is never listed, so a
 * lost link can only be revoked and created again. Review roles see Gap Interview links; only the
 * creator sees invitations and who they were sent to.
 */
export function AccessLinks({ tokens, creator }: { tokens: AccessTokenSummary[]; creator: boolean }) {
  const { run } = useAction();
  const invites = tokens.filter((t) => t.purpose === "member_invite");
  const gapLinks = tokens.filter((t) => t.purpose === "gap_interview");
  const pendingInvites = invites.filter((t) => t.status === "active");

  const revoke = (t: AccessTokenSummary, label: string) => (
    <ConfirmDialog
      trigger={
        <Button size="xs" variant="ghost" aria-label={`Revoke ${label}`}>
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
            <ul className="divide-y divide-border rounded-lg border border-border">
              {invites.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <Mail aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.recipientEmail ?? "Invitation"}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.grantRole ? memberRoleLabel[t.grantRole] : "Member"} · sees {accessLevelMeta[t.maxAccessLevel].label.toLowerCase()} · {tokenStatusDetail(t, formatDate)}
                    </p>
                  </div>
                  <StatusPill token={t} />
                  {t.status === "active" && revoke(t, `the invitation for ${t.recipientEmail ?? "this person"}`)}
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
          <ul className="divide-y divide-border rounded-lg border border-border">
            {gapLinks.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <Link2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
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
