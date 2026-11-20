import Link from "next/link";

import { formatDate } from "@/components/handover/format";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { AccountOverview } from "@/lib/supabase/account-auth";
import { cn } from "@/lib/utils";

interface AccountDetailsProps {
  overview: AccountOverview;
  /** Handovers the user created, and others they are a member of (from listMyHandovers); null if unavailable. */
  handovers: { created: number; memberOf: number } | null;
}

/** The signed-in user's own account: email, sign-in methods, dates and handover counts. Server component. */
export function AccountDetails({ overview, handovers }: AccountDetailsProps) {
  const google = overview.providers.includes("google");
  const password = overview.hasPassword;

  return (
    <section aria-labelledby="account-details-heading" className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 id="account-details-heading" className="type-heading">
        Account details
      </h2>

      <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        <dt className="text-muted-foreground">Email</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium break-all">{overview.email ?? "No email address"}</span>
          {overview.email ? (
            <Badge tone={overview.emailConfirmed ? "success" : "warning"} size="sm">
              {overview.emailConfirmed ? "Verified" : "Not verified"}
            </Badge>
          ) : null}
        </dd>

        <dt className="text-muted-foreground">Account created</dt>
        <dd>{overview.createdAt ? <time dateTime={overview.createdAt}>{formatDate(overview.createdAt)}</time> : "Unknown"}</dd>

        <dt className="text-muted-foreground">Last sign-in</dt>
        <dd>{overview.lastSignInAt ? <time dateTime={overview.lastSignInAt}>{formatDate(overview.lastSignInAt)}</time> : "Unknown"}</dd>

        {handovers ? (
          <>
            <dt className="text-muted-foreground">Handovers</dt>
            <dd>
              {handovers.created === 1 ? "1 created by you" : `${handovers.created} created by you`}
              <span className="text-muted-foreground"> · </span>
              {handovers.memberOf === 1 ? "member of 1 other" : `member of ${handovers.memberOf} others`}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="space-y-3 border-t border-border pt-5">
        <h3 id="signin-methods" className="text-sm font-medium">
          Sign-in methods
        </h3>
        <ul aria-labelledby="signin-methods" className="divide-y divide-border border-y border-border">
          <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Google</p>
              <p className="text-xs text-muted-foreground">
                {google
                  ? "Continue with Google opens this account."
                  : "Not linked yet. Continue with Google using this same address and it links to this account."}
              </p>
            </div>
            <span className="self-start text-caption text-muted-foreground sm:self-auto">{google ? "Linked" : "Not linked"}</span>
          </li>
          <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Email and password</p>
              <p className="text-xs text-muted-foreground">
                {password === true
                  ? "You can sign in with your email address and password."
                  : password === false
                    ? "No password yet. Set one to sign in without Google."
                    : "Set or change the password you use with your email address."}
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {password !== null ? (
                <span className="text-caption text-muted-foreground">{password ? "Set" : "Not set"}</span>
              ) : null}
              <Link href="/account/password" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {password === true ? "Change password" : password === false ? "Set a password" : "Set or change password"}
              </Link>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}
