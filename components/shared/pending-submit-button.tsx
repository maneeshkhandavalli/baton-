"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * R3 Task 06: a submit button for a server-action <form> that shows it is working and cannot be pressed twice while
 * the action runs (accepting an invitation can take a few seconds). The action itself stays idempotent regardless.
 */
export function PendingSubmitButton({
  children,
  pendingLabel,
  size,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
