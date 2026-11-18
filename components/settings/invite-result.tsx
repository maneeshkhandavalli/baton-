"use client";

import { Check, CircleAlert, Copy, MailCheck } from "lucide-react";
import { useState } from "react";

import { formatDate } from "@/components/handover/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreatedInvitation } from "@/lib/contracts/dto";
import { cn } from "@/lib/utils";

import { deliveryMessage } from "./invite-delivery";

/**
 * The outcome of inviting someone or reissuing an invitation (R3 Task 06, contract §4.3, A6): whether the email went
 * out, and the one-time link. When nothing was emailed the copy button is the primary action.
 */
export function InviteResult({ invitation, email, className }: { invitation: CreatedInvitation; email: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  const msg = deliveryMessage(invitation.delivery, email);
  // The real action returns an absolute URL (BATON_SITE_URL); the mock returns a path.
  const link = typeof window === "undefined" ? invitation.url : new URL(invitation.url, window.location.origin).href;
  const Icon = msg.tone === "success" ? MailCheck : CircleAlert;

  return (
    <div role="status" className={cn("space-y-2 rounded-lg border p-3", msg.tone === "success" ? "border-success/25 bg-success-soft/50" : "border-warning/30 bg-warning-soft/60", className)}>
      <p className={cn("flex items-start gap-2 text-sm font-medium", msg.tone === "success" ? "text-success-fg" : "text-warning-fg")}>
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {msg.title}
      </p>
      <p className="text-caption text-foreground/80">
        {msg.body} It works once and expires on <time dateTime={invitation.expiresAt}>{formatDate(invitation.expiresAt)}</time>; the person signs in with the invited address to accept.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label="Invitation link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant={msg.linkPrimary ? "default" : "outline"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check aria-hidden="true" data-icon="inline-start" /> : <Copy aria-hidden="true" data-icon="inline-start" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
