"use client";

/**
 * "Judging Baton?": one-press sign-in to the shared demo accounts (lib/demo-accounts.ts). Renders nothing unless
 * NEXT_PUBLIC_BATON_DEMO_* credentials are configured. The credentials are public by design and shown so judges
 * can also type them. Sign-in goes through the existing password Server Function (passed in as `signIn`), with
 * its pending and error states; on success the browser goes to `next` (already sanitised by the page) or the
 * dashboard, exactly like the email and password form.
 */

import { useId, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_ACCOUNTS, type DemoAccount, type DemoAccountRole } from "@/lib/demo-accounts";
import { routes } from "@/lib/routes";
import type { PasswordResult } from "@/lib/supabase/password-auth";

const OFFLINE = "We couldn't reach Baton. Check your connection and try again.";

export interface DemoAccountPanelProps {
  next: string | null;
  /** The existing password sign-in Server Function (app/(auth)/login/actions.ts signInWithPassword). */
  signIn: (email: string, password: string) => Promise<PasswordResult>;
  /** Defaults to the configured accounts; tests pass their own. */
  accounts?: readonly DemoAccount[];
}

export function DemoAccountPanel({ next, signIn, accounts = DEMO_ACCOUNTS }: DemoAccountPanelProps) {
  if (accounts.length === 0) return null;
  return <DemoAccountPanelBody next={next} signIn={signIn} accounts={accounts} />;
}

function DemoAccountPanelBody({ next, signIn, accounts }: Required<DemoAccountPanelProps>) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<DemoAccountRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signInAs = (account: DemoAccount) => {
    setActive(account.role);
    setError(null);
    startTransition(async () => {
      let r: PasswordResult;
      try {
        r = await signIn(account.email, account.password);
      } catch {
        r = { status: "error", message: OFFLINE };
      }
      if (r.status === "ok") {
        // Session cookies are set. A full navigation makes every server component see them.
        window.location.assign(next ?? routes.dashboard);
        return; // keep the pending state until the page changes
      }
      setError(r.message);
      setActive(null);
    });
  };

  return (
    <Card size="sm" aria-labelledby={`${id}-h`} role="region">
      <CardHeader>
        <CardTitle>
          <h2 id={`${id}-h`}>Judging Baton?</h2>
        </CardTitle>
        <CardDescription>Use a ready-made demo account with real data, no sign-up needed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.map((account) => {
          const busy = pending && active === account.role;
          return (
            <div key={account.role} className="space-y-1.5">
              <Button
                type="button"
                size="lg"
                variant="secondary"
                className="w-full"
                disabled={pending}
                aria-busy={busy}
                aria-describedby={`${id}-${account.role}-creds`}
                onClick={() => signInAs(account)}
              >
                {busy ? "Signing in…" : account.label}
              </Button>
              <p id={`${id}-${account.role}-creds`} className="text-caption text-muted-foreground">
                <span className="sr-only">Demo credentials: </span>
                <span className="font-mono">{account.email}</span>
                {" / "}
                <span className="font-mono">{account.password}</span>
              </p>
            </div>
          );
        })}
        {error ? (
          <Alert id={`${id}-msg`} tone="danger">
            {error}
          </Alert>
        ) : null}
        <p className="text-caption text-muted-foreground">
          Shared demo accounts with synthetic data. Deleting the account and changing its password are turned off.
        </p>
      </CardContent>
    </Card>
  );
}
