/**
 * Round 4 audit A2: the password page distinguishes "Set a password" (no password yet, e.g. a Google-only account)
 * from "Change your password" (a password exists). Changing one needs the current password (reauthentication),
 * except right after a "set a new password" email link (a recovery sign-in), which is how someone who forgot it
 * gets back in: the page then shows "Set a new password" without the current-password field. The page and the
 * server action decide with the same rule (needsCurrentPassword). Pure, no I/O.
 */

export type PasswordMode = "set" | "change" | "reset";

export const PASSWORD_PAGE_COPY: Record<PasswordMode, { title: string; description: string; submit: string; done: string }> = {
  set: {
    title: "Set a password",
    description: "Add a password to sign in with your email address as well as with Google. It's the same account either way.",
    submit: "Set password",
    done: "Password set",
  },
  change: {
    title: "Change your password",
    description: "Enter your current password, then choose a new one. Forgot it? Use the \"Forgot or never set a password?\" link on the sign-in page instead.",
    submit: "Change password",
    done: "Password changed",
  },
  reset: {
    title: "Set a new password",
    description: "Choose a new password for your account. You don't need your old one.",
    submit: "Save new password",
    done: "Password changed",
  },
};

/** How long after a recovery-link sign-in the current password isn't asked for. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;

/**
 * `amr` methods that mean "signed in through the password-reset link emailed to this address". Supabase Auth
 * records a reset as "recovery" (PKCE code exchange, and verifyOtp with type "recovery"). "otp" is NOT accepted:
 * it is an emailed sign-in code, and accepting it would let a session from any recent code sign-in change the
 * password without the current one (main review, 21 Nov).
 */
const RECOVERY_METHODS: ReadonlySet<unknown> = new Set(["recovery"]);

/** The clock both callers pass in (seconds, like the JWT `amr` timestamps). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** True when the session came from a "set a new password" email link within the window (JWT `amr` claim). */
export function isRecentRecovery(amr: unknown, nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((m) => {
    if (!m || typeof m !== "object") return false;
    const { method, timestamp } = m as { method?: unknown; timestamp?: unknown };
    return RECOVERY_METHODS.has(method) && typeof timestamp === "number" && nowSeconds - timestamp >= 0 && nowSeconds - timestamp <= RECOVERY_WINDOW_SECONDS;
  });
}

/**
 * Whether the current password must be checked before the new one is saved: always, unless the account is known
 * to have none or the session is a fresh recovery sign-in. When it couldn't be read (null) it IS required (fail
 * closed: a stolen session must not change the password without it).
 */
export function needsCurrentPassword(hasPassword: boolean | null, amr: unknown, nowSeconds: number): boolean {
  return hasPassword !== false && !isRecentRecovery(amr, nowSeconds);
}

/**
 * The page's form, from the same rule as the server: "change" (asks for the current password) when it is needed,
 * otherwise "set" (no password yet) or "reset" (right after a recovery link).
 */
export function passwordPageMode(hasPassword: boolean | null, amr: unknown, nowSeconds: number): PasswordMode {
  if (needsCurrentPassword(hasPassword, amr, nowSeconds)) return "change";
  return hasPassword === false ? "set" : "reset";
}
