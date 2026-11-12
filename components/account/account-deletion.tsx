"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatDate } from "@/components/handover/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import type { AccountDeletionBlockers } from "@/lib/contracts/dto";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/contracts/schemas";
import { deleteAccount } from "@/lib/actions/account";

import { accountDeletionRequest } from "./deletion-confirmation";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** An open creatorship offer the viewer made for one of their handovers (from `HandoverSummary`). */
export interface OutgoingOffer {
  toLabel: string;
  offeredAt: string;
}

interface AccountDeletionProps {
  blockers: AccountDeletionBlockers;
  /** handoverId → the open offer, for handovers the viewer is transferring. */
  offers: Record<string, OutgoingOffer>;
}

/**
 * Account deletion (§12.9, D25). Blocked until every created handover, including soft-deleted ones
 * still in their grace period, is transferred (offer accepted) or explicitly marked for permanent
 * deletion. The user must type DELETE; the typed word itself is sent and checked on the server.
 */
export function AccountDeletion({ blockers, offers }: AccountDeletionProps) {
  const router = useRouter();
  const { run, isPending, error, clearError } = useAction();
  const created = blockers.createdHandovers;
  const [purge, setPurge] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const allResolved = created.every((h) => purge.includes(h.id));
  const purging = created.filter((h) => purge.includes(h.id));
  const typedMatches = typed === ACCOUNT_DELETION_CONFIRMATION;

  function setDialog(next: boolean) {
    if (isPending) return;
    setOpen(next);
    if (!next) {
      setTyped("");
      clearError();
    }
  }

  function submit() {
    // The prompt is an extra safeguard only: the action validates the word again (deleteAccountInput).
    const request = accountDeletionRequest(typed, purge);
    if (!request) return;
    void run(() => deleteAccount(request), {
      success: "Your account was deleted",
      onSuccess: () => router.push(routes.home),
      onError: () => true, // shown inside the dialog
    });
  }

  return (
    <section aria-labelledby="delete-account-heading" className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-soft sm:p-6">
      <div className="space-y-1">
        <h2 id="delete-account-heading" className="text-base font-semibold">
          Delete your account
        </h2>
        <p className="text-sm text-muted-foreground">
          Your name is replaced with &ldquo;Former member&rdquo; wherever it appears. Answers and approvals you made stay, so handovers remain traceable.
        </p>
      </div>

      {created.length > 0 ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-inferred" />
            <span>
              You created {created.length === 1 ? "1 handover" : `${created.length} handovers`}. Each one needs a new creator, who accepts your offer in
              its settings, or must be deleted permanently with your account.
            </span>
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {created.map((h) => {
              const checked = purge.includes(h.id);
              const offer = offers[h.id];
              return (
                <li key={h.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{h.title}</p>
                    {h.deleted ? (
                      <p className="text-xs text-muted-foreground">Deleted, waiting for the 30-day permanent removal. It still counts as yours until then.</p>
                    ) : offer ? (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock aria-hidden="true" className="size-3.5 shrink-0" />
                        Offered to {offer.toLabel} on {formatDate(offer.offeredAt)}. Waiting for them to accept.
                      </p>
                    ) : null}
                  </div>
                  {!h.deleted && !offer && (
                    <Link href={`${routes.handover.settings(h.id)}#danger`} className="text-xs font-medium text-primary hover:underline">
                      Transfer instead
                    </Link>
                  )}
                  <label
                    className={cn(
                      "inline-flex items-center gap-2 self-start rounded-md border px-2 py-1 text-xs sm:self-auto",
                      checked ? "border-destructive/40 bg-destructive/5 text-destructive-fg" : "border-border",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--destructive)]"
                      checked={checked}
                      onChange={() => setPurge((p) => (checked ? p.filter((x) => x !== h.id) : [...p, h.id]))}
                    />
                    Delete permanently
                  </label>
                </li>
              );
            })}
          </ul>
          {!allResolved && (
            <p className="text-xs text-muted-foreground">
              {created.length - purging.length === 1 ? "1 handover still blocks" : `${created.length - purging.length} handovers still block`} deletion.
            </p>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-success-fg">
          <CheckCircle2 aria-hidden="true" className="size-4" />
          Nothing is blocking deletion.
        </p>
      )}

      <Button variant="destructive" disabled={!allResolved} onClick={() => setDialog(true)}>
        <Trash2 aria-hidden="true" data-icon="inline-start" />
        Delete account
      </Button>

      <Dialog open={open} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>This can&rsquo;t be undone. You&rsquo;ll be signed out and lose access to every handover.</DialogDescription>
          </DialogHeader>
          {purging.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive-fg">
                {purging.length === 1 ? "This handover is" : "These handovers are"} deleted permanently, for every member, right away:
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {purging.map((h) => (
                  <li key={h.id}>{h.title}</li>
                ))}
              </ul>
            </div>
          )}
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Label htmlFor="confirm-delete">
              Type <span className="font-mono font-semibold">{ACCOUNT_DELETION_CONFIRMATION}</span> to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (error) clearError();
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={!!error || (typed.length > 0 && !typedMatches)}
              aria-describedby="confirm-delete-hint"
            />
            <p id="confirm-delete-hint" className={cn("text-xs", error ? "text-destructive-fg" : "text-muted-foreground")} role={error ? "alert" : undefined}>
              {error ? error.message : `Capital letters, exactly as shown.`}
            </p>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!typedMatches || isPending} aria-busy={isPending} onClick={submit}>
              {isPending ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
