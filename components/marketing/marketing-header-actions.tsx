import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { connection } from "next/server";

import { AccountMenu } from "@/components/layout/account-menu";
import { routes } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The marketing header's right-hand action, the one place on the page that depends on the session (server
 * component, streamed inside Suspense so the page shell stays static and cacheable):
 *  - signed in:  the account menu (hidden on phones, where the pill has no room) and "Open workspace", the
 *                header's single primary action;
 *  - signed out: "Sign in" as a quiet outlined pill. The hero's "Try the demo" is the page's primary action.
 * The session is validated with the Supabase Auth server (getUser, never a decoded cookie), as in
 * components/layout/header-account.tsx. `data-session` lets landing.css calm the hero's primary pill for a
 * signed-in visitor, so one viewport never shows two ink pills.
 */
export async function MarketingHeaderActions() {
  await connection(); // session reads check token expiry against the current time; request-time only
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data?.user;

  if (!user) {
    return (
      <span className="lp-nav__actions" data-session="out">
        <SignInLink />
      </span>
    );
  }

  return (
    <span className="lp-nav__actions" data-session="in">
      <span className="lp-nav__account contents max-sm:hidden">
        <AccountMenu name={accountName(user.user_metadata, user.email ?? null)} email={user.email ?? null} />
      </span>
      <Link href={routes.dashboard} className="lp-cta ml-1">
        <span aria-hidden="true" className="lp-cta__disc max-sm:hidden">
          <ArrowUpRight className="size-4" />
        </span>
        <span className="lp-cta__label">
          <span className="sm:hidden">Workspace</span>
          <span className="hidden sm:inline">Open workspace</span>
        </span>
      </Link>
    </span>
  );
}

/** The signed-out action; also the no-JavaScript fallback (a signed-in visitor who follows it lands on the dashboard). */
export function SignInLink() {
  return (
    <Link href={routes.login} className="lp-cta lp-cta--ghost ml-1">
      <span className="lp-cta__label">Sign in</span>
    </Link>
  );
}

/**
 * Holds the action's place while the session streams in, so the pill does not change width (no layout shift),
 * and gives visitors without JavaScript (where the streamed part never swaps in) a working "Sign in".
 */
export function MarketingHeaderActionsFallback() {
  return (
    <span className="lp-nav__actions">
      <span aria-hidden="true" className="lp-cta lp-cta--ghost invisible ml-1">
        <span className="lp-cta__label">Sign in</span>
      </span>
      <noscript>
        <SignInLink />
      </noscript>
    </span>
  );
}

/** A display name from the auth profile (Google gives full_name/name), else the email's local part. */
function accountName(meta: Record<string, unknown> | undefined, email: string | null): string {
  for (const key of ["display_name", "full_name", "name"]) {
    const v = meta?.[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim().slice(0, 60);
  }
  return email?.split("@")[0]?.slice(0, 60) || "Your account";
}
