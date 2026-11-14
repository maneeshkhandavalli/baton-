/**
 * Which sign-in methods Baton offers (client-safe; NEXT_PUBLIC values are inlined at build time).
 *
 * Google (Supabase OAuth) is the primary method. Email magic links depend on email delivery, which is
 * currently unreliable (free sending domain and provider rate limits), so they are hidden rather than shown
 * as a method that may silently never arrive. Set NEXT_PUBLIC_BATON_EMAIL_LOGIN=on to offer them again;
 * the magic-link code paths are unchanged.
 */
export const EMAIL_LOGIN_ENABLED: boolean = process.env.NEXT_PUBLIC_BATON_EMAIL_LOGIN === "on";
