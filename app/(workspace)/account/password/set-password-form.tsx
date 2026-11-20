"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_ACCOUNT_REFUSAL } from "@/lib/demo-accounts";
import { PASSWORD_PAGE_COPY, type PasswordMode } from "@/components/account/password-mode";

import { setPassword, type PasswordFormResult } from "./actions";

/**
 * `mode`: "change" asks for the current password (the server checks it); "set" (no password yet) and "reset" (right
 * after a "set a new password" email link) don't. The page picks it with the server's rule (passwordPageMode).
 * `demoAccount`: the viewer is a shared demo account; the form is turned off (the server refuses it too).
 */
export function SetPasswordForm({ mode = "set", demoAccount = false }: { mode?: PasswordMode; demoAccount?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PasswordFormResult | null>(null);
  const copy = PASSWORD_PAGE_COPY[mode];
  const err = result?.status === "error" ? result : null;

  if (result?.status === "ok") {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={copy.done}>
          {result.message}
        </Alert>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Go to your dashboard
        </Link>
      </div>
    );
  }

  return (
    <form
      className="max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-soft"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(async () => {
          try {
            setResult(await setPassword(String(f.get("password") ?? ""), String(f.get("confirm") ?? ""), mode === "change" ? String(f.get("current") ?? "") : undefined));
          } catch {
            setResult({ status: "error", message: "We couldn't reach Baton. Check your connection and try again." });
          }
        });
      }}
    >
      {mode === "change" && (
        <div className="space-y-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            name="current"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={err?.field === "current" ? true : undefined}
            aria-describedby={err?.field === "current" ? "password-error" : undefined}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-invalid={err?.field === "password" ? true : undefined} aria-describedby="new-password-hint" />
        <p id="new-password-hint" className="text-caption text-muted-foreground">
          At least 8 characters.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Repeat the password</Label>
        <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required aria-invalid={err?.field === "confirm" ? true : undefined} />
      </div>
      {err ? (
        <Alert tone="danger" id="password-error">
          {err.message}
        </Alert>
      ) : null}
      {demoAccount ? (
        <p id="set-password-demo" className="text-caption text-muted-foreground">
          {DEMO_ACCOUNT_REFUSAL}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || demoAccount} aria-busy={pending} aria-describedby={demoAccount ? "set-password-demo" : undefined}>
        {pending ? "Saving…" : copy.submit}
      </Button>
    </form>
  );
}
