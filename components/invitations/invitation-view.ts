/**
 * Invitation landing (/h/[token]) view states (R3 Task 06, frozen contract §4.1 / §4.2, amendments A4 and A5).
 * Pure and React-free (components/invitations/__tests__/invitation-view.test.ts).
 *
 * The page maps the result of `getInvitation` (read-only, safe during render) or the failure of `acceptInvitation`
 * (only ever called from an explicit submit, A4) to ONE screen. An unknown reason renders the generic state for its
 * code (A5), and an unknown code renders the generic error, so a newer server never breaks an older page.
 *
 * Nothing here ever shows more than the contract allows: title, inviter, role, expiry and the MASKED address only
 * for a pending invitation; nothing about the handover for any failure state.
 */

import type { AppError, Result } from "@/lib/contracts/api";
import type { InvitationDetails } from "@/lib/contracts/dto";
import type { MemberRole } from "@/lib/contracts/enums";

export type InvitationScreen =
  | "sign_in_required"
  | "ready_to_accept"
  | "wrong_account"
  | "email_unconfirmed"
  | "already_member"
  | "already_accepted"
  | "invalid_link"
  | "expired"
  | "revoked"
  | "used"
  | "unavailable"
  | "too_many_attempts"
  | "error";

/** What a pending invitation may show (contract D3). */
export interface InvitationSummary {
  handoverTitle: string;
  inviterName: string;
  role: MemberRole;
  expiresAt: string;
  recipientEmailMasked: string;
}

export interface InvitationView {
  screen: InvitationScreen;
  /** Only for the pending states (sign_in_required, ready_to_accept, wrong_account, email_unconfirmed). */
  summary: InvitationSummary | null;
  /** Where an existing member continues (already_member, already_accepted); an internal path or null. */
  memberHref: string | null;
}

const TOKEN_INVALID_REASONS: Readonly<Record<string, InvitationScreen>> = {
  invalid: "invalid_link",
  expired: "expired",
  revoked: "revoked",
  used: "used",
  unavailable: "unavailable",
  // acceptInvitation only (§4.2)
  email_mismatch: "wrong_account",
  email_unconfirmed: "email_unconfirmed",
};

/** A same-origin path only ("/handover/…"); anything else (absolute, protocol-relative, backslash) is dropped. */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}

const view = (screen: InvitationScreen, extra: Partial<InvitationView> = {}): InvitationView => ({ screen, summary: null, memberHref: null, ...extra });

/** The screen for a failed getInvitation / acceptInvitation (§4.1 / §4.2). Unknown reason → generic for its code. */
export function invitationViewFromError(error: Pick<AppError, "code" | "details">): InvitationView {
  const reason = typeof error.details?.reason === "string" ? error.details.reason : null;
  switch (error.code) {
    case "token_invalid":
      return view((reason && TOKEN_INVALID_REASONS[reason]) || "invalid_link");
    case "unauthenticated":
      // Accept without a session; the page re-reads the invitation to show what it is for.
      return view("sign_in_required");
    case "conflict":
      return reason === "already_member" ? view("already_member", { memberHref: safeInternalPath(error.details?.memberHref) }) : view("error");
    case "rate_limited":
      return view("too_many_attempts");
    default:
      return view("error");
  }
}

/** The screen for getInvitation's result (§4.1). */
export function invitationViewFromDetails(result: Result<InvitationDetails>): InvitationView {
  if (!result.ok) return invitationViewFromError(result.error);
  const d = result.data;
  if (d.state === "accepted") return view("already_accepted", { memberHref: safeInternalPath(d.memberHref) });
  if (d.state !== "pending") return view("error"); // a state this page does not know yet (A5)
  const summary: InvitationSummary = {
    handoverTitle: d.handoverTitle,
    inviterName: d.inviterName,
    role: d.role,
    expiresAt: d.expiresAt,
    recipientEmailMasked: d.recipientEmailMasked,
  };
  const v = d.viewer;
  if (!v) return view("sign_in_required", { summary });
  // Order matters: an existing member is told so first; a mismatched address before an unconfirmed one.
  if (v.alreadyMember) return view("already_member", { summary, memberHref: safeInternalPath(d.memberHref) });
  if (!v.emailMatches) return view("wrong_account", { summary });
  if (!v.emailConfirmed) return view("email_unconfirmed", { summary });
  return view("ready_to_accept", { summary });
}

/* ── Accept round-trip: the form action redirects back with the failure as query parameters ─────────────── */

const CODE_PARAM = /^[a-z_]{1,40}$/;

/**
 * Encodes a failed accept as `?error=<code>&reason=<reason>` (tokens only: never a message or an address), plus
 * `member=<path>` for already_member when the server gave a same-origin member page.
 */
export function acceptFailureQuery(error: Pick<AppError, "code" | "details">): string {
  const params = new URLSearchParams({ error: CODE_PARAM.test(error.code) ? error.code : "internal" });
  const reason = error.details?.reason;
  if (typeof reason === "string" && CODE_PARAM.test(reason)) params.set("reason", reason);
  const member = safeInternalPath(error.details?.memberHref);
  if (reason === "already_member" && member) params.set("member", member);
  return params.toString();
}

/** Reads `?error=&reason=` back. Anything malformed becomes the generic error (A5). */
export function invitationViewFromQuery(query: Record<string, string | string[] | undefined>): InvitationView | null {
  const code = query.error;
  if (code === undefined) return null;
  if (typeof code !== "string" || !CODE_PARAM.test(code)) return view("error");
  const reason = typeof query.reason === "string" && CODE_PARAM.test(query.reason) ? query.reason : undefined;
  const member = reason === "already_member" ? safeInternalPath(query.member) : null;
  return invitationViewFromError({ code: code as AppError["code"], details: reason ? { reason, ...(member ? { memberHref: member } : {}) } : undefined });
}

/* ── Copy ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface InvitationCopy {
  tone: "neutral" | "error";
  title: string;
  description: string;
  steps?: string[];
}

export function invitationCopy(v: InvitationView, roleLabel: (r: MemberRole) => string): InvitationCopy {
  const s = v.summary;
  const forWhat = s ? `${s.inviterName} invited you to “${s.handoverTitle}” as ${roleLabel(s.role).toLocaleLowerCase()}.` : "";
  switch (v.screen) {
    case "sign_in_required":
      return {
        tone: "neutral",
        title: "You've been invited to a handover",
        description: `${forWhat} Sign in with the account for ${s?.recipientEmailMasked ?? "the invited address"} to accept it.`.trim(),
        steps: ["Sign in with the invited email address, or create an account with it.", "You come straight back to this invitation.", "Accept, and the handover opens."],
      };
    case "ready_to_accept":
      return { tone: "neutral", title: "Accept the invitation", description: `${forWhat} You're signed in with the invited address.`.trim() };
    case "wrong_account":
      return {
        tone: "error",
        title: "This invitation is for another address",
        description: `This invitation is for ${s?.recipientEmailMasked ?? "a different email address"}. You're signed in with another address. Sign out, then sign in with the invited one.`,
      };
    case "email_unconfirmed":
      return {
        tone: "error",
        title: "Confirm your email address first",
        description: "You're signed in with the invited address, but it isn't confirmed yet. Open the confirmation email we sent you, or sign in again to get a new one, then come back to this link.",
      };
    case "already_member":
      return { tone: "neutral", title: "You're already a member", description: "You already have access to this handover." };
    case "already_accepted":
      return { tone: "neutral", title: "Invitation accepted", description: "You've already accepted this invitation. Open the handover to continue." };
    case "invalid_link":
      return { tone: "error", title: "This link isn't valid", description: "Check that you copied the whole link, or ask the person who invited you for a new one." };
    case "expired":
      return { tone: "error", title: "This invitation has expired", description: "Ask the person who invited you for a new link." };
    case "revoked":
      return { tone: "error", title: "This invitation was withdrawn", description: "The person who invited you turned this link off. Ask them for a new one if you still need access." };
    case "used":
      return {
        tone: "error",
        title: "This invitation has already been used",
        description: "Someone has already accepted it. If that was you, sign in with the account you used then.",
      };
    case "unavailable":
      return { tone: "error", title: "This handover is no longer available", description: "It may have been deleted. Ask the person who invited you." };
    case "too_many_attempts":
      return { tone: "error", title: "Too many attempts", description: "Please wait a few minutes and try again." };
    case "error":
      return { tone: "error", title: "Something went wrong", description: "We couldn't open this invitation. Please try again in a moment." };
  }
}
