/**
 * What the creator is told after inviting someone or reissuing an invitation (R3 Task 06, frozen contract §4.3, A6).
 * Pure and React-free (components/settings/__tests__/invite-delivery.test.ts).
 *
 * A6: when the email was NOT sent, the copyable link is the primary action and the message says plainly that no
 * email went out and why. An unknown delivery status or reason is treated as "not sent" (never as sent).
 */

import type { AppError } from "@/lib/contracts/api";
import type { AccessTokenSummary, InvitationDelivery } from "@/lib/contracts/dto";

export interface DeliveryMessage {
  tone: "success" | "warning";
  title: string;
  body: string;
  /** True when the copy-link button is the main way to deliver the invitation. */
  linkPrimary: boolean;
}

export function deliveryMessage(delivery: InvitationDelivery | null | undefined, email: string | null): DeliveryMessage {
  const to = email ? ` to ${email}` : "";
  if (delivery?.status === "sent") {
    return {
      tone: "success",
      title: `Invitation emailed${to}`,
      body: "It can land in spam. The link below works too, if you'd rather send it yourself. It is shown only now.",
      linkPrimary: false,
    };
  }
  const reason = delivery?.status === "not_sent" ? delivery.reason : null;
  switch (reason) {
    case "email_not_configured":
      return {
        tone: "warning",
        title: "No email was sent",
        body: "Email isn't set up on this server; send the link yourself. Copy it now: it is shown only once.",
        linkPrimary: true,
      };
    case "provider_failed":
      return {
        tone: "warning",
        title: "We couldn't email the invitation",
        body: "Copy the link and send it yourself, or use “Send a new link” later to try the email again. The link is shown only once.",
        linkPrimary: true,
      };
    case "demo":
      return { tone: "warning", title: "Demo: nothing was sent", body: "In the demo no email is ever sent and no real invitation exists.", linkPrimary: true };
    default:
      return { tone: "warning", title: "No email was sent", body: "Copy the link and send it yourself. It is shown only once.", linkPrimary: true };
  }
}

/** Plain words for the failures in §4.3; unknown reasons fall back to the server's safe message (A5). */
export function inviteErrorMessage(error: Pick<AppError, "code" | "message" | "details">): string {
  const reason = typeof error.details?.reason === "string" ? error.details.reason : null;
  switch (error.code) {
    case "forbidden":
      return "Only the creator can invite members.";
    case "not_found":
      return "This handover or invitation no longer exists.";
    case "conflict":
      return reason === "already_member" ? "This person is already a member." : error.message;
    case "invalid_transition":
      return reason === "invite_used" ? "This invitation was already accepted." : error.message;
    case "rate_limited":
      return reason === "invite_send" ? "You've sent a lot of invitations. Try again in an hour." : "Too many attempts. Please wait a few minutes and try again.";
    case "unauthenticated":
      return "Your session ended. Sign in again to invite people.";
    default:
      return error.message;
  }
}

/**
 * Whether an invitation row offers "Send a new link" (§3.2 item 4: reissue replaces an active or expired invitation).
 * Never for an accepted (exhausted) one (reissue → invite_used) or one the creator revoked on purpose.
 */
export function canReissue(t: Pick<AccessTokenSummary, "purpose" | "status">): boolean {
  return t.purpose === "member_invite" && (t.status === "active" || t.status === "expired");
}

/** The delivery note on an invitation row (AccessTokenSummary.deliveryStatus, invitations only). */
export function deliveryStatusLabel(status: AccessTokenSummary["deliveryStatus"] | undefined): string | null {
  switch (status) {
    case "sent":
      return "emailed";
    case "not_sent":
      return "not emailed: link shared by hand";
    case "failed":
      return "email failed";
    default:
      return null;
  }
}
