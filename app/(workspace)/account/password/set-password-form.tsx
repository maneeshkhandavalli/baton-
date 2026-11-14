"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PasswordResult } from "@/lib/supabase/password-auth";

import { setPassword } from "./actions";

export function SetPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PasswordResult | null>(null);
  const err = result?.status === "error" ? result : null;

  if (result?.status === "ok") {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Password set">
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
            setResult(await setPassword(String(f.get("password") ?? ""), String(f.get("confirm") ?? "")));
          } catch {
            setResult({ status: "error", message: "We couldn't reach Baton. Check your connection and try again." });
          }
        });
      }}
    >
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
      {err ? <Alert tone="danger">{err.message}</Alert> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
