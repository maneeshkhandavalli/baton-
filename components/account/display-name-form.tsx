"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateDisplayName } from "@/app/(workspace)/account/display-name-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_ACCOUNT_REFUSAL } from "@/lib/demo-accounts";

import { checkDisplayName, DISPLAY_NAME_MAX } from "./display-name";

/**
 * Round 4 audit D1: the name other members see (invitations, "published by", confirmations). Optional: until it is
 * set, Baton shows the part of the email address before the @. Demo accounts can't change theirs.
 */
export function DisplayNameForm({ current, demoAccount = false }: { current: string | null; demoAccount?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const unchanged = value.trim() === (current ?? "").trim();

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const checked = checkDisplayName(value);
        if (!checked.ok) return setMessage({ tone: "danger", text: checked.message });
        startTransition(async () => {
          try {
            const r = await updateDisplayName(checked.name);
            if (r.ok) {
              setValue(r.name);
              setMessage({ tone: "success", text: "Saved. Other members now see this name." });
              router.refresh();
            } else setMessage({ tone: "danger", text: r.message });
          } catch {
            setMessage({ tone: "danger", text: "We couldn't reach Baton. Check your connection and try again." });
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="display-name">Your name</Label>
        <Input
          id="display-name"
          name="displayName"
          autoComplete="name"
          maxLength={DISPLAY_NAME_MAX}
          value={value}
          disabled={demoAccount}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
          aria-invalid={message?.tone === "danger" ? true : undefined}
          aria-describedby="display-name-hint"
        />
        <p id="display-name-hint" className="text-caption text-muted-foreground">
          {demoAccount ? DEMO_ACCOUNT_REFUSAL : "Shown to the people in your handovers. Quotes and answers already published keep the name they were given with."}
        </p>
      </div>
      {message && (
        <Alert tone={message.tone}>
          {message.text}
        </Alert>
      )}
      <Button type="submit" size="sm" disabled={pending || demoAccount || unchanged} aria-busy={pending}>
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
