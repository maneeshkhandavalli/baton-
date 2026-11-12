"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { deleteHandover } from "@/lib/actions/handovers";

/** Discards a draft through the creator-only deleteHandover action (soft delete; D27 keeps purge disabled). */
export function DiscardDraftButton({ handoverId, title }: { handoverId: string; title: string }) {
  const router = useRouter();
  const { run, isPending } = useAction();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="self-end text-muted-foreground" disabled={isPending}>
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          Discard draft
        </Button>
      }
      title={`Discard “${title}”?`}
      description="The draft and its uploaded files are removed from your workspace. This can't be undone here."
      confirmLabel="Discard draft"
      destructive
      onConfirm={async () => {
        const r = await run(() => deleteHandover({ handoverId }), { success: "Draft discarded" });
        if (r.ok) router.refresh();
      }}
    />
  );
}
