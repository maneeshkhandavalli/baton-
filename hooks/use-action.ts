"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";

import type { AppError, Result } from "@/lib/contracts/api";

interface RunOptions<T> {
  /** Toast on success. Pass a function to build it from the result. */
  success?: string | ((data: T) => string);
  /** Called with the data on success. */
  onSuccess?: (data: T) => void;
  /** Called with the error; return true to suppress the default error toast. */
  onError?: (error: AppError) => boolean | void;
}

const STALE_RELOAD_KEY = "baton:stale-action-reload";

/**
 * A new deployment changes server action IDs, so a page loaded from the previous deployment
 * gets "Server Action not found" on its next click. Reload once to pick up the new build;
 * the timestamp guard stops a reload loop if the error persists after reloading.
 */
function reloadForNewDeployment(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(STALE_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    window.sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: still reload, the user clicked and expects something to happen.
  }
  window.location.reload();
  return true;
}

/**
 * Runs a server action that returns `Result<T>` (§3.2), tracking pending state and showing
 * friendly toasts. Actions never throw across the boundary, but a network failure still can,
 * so that case is mapped to a retryable internal error.
 */
export function useAction() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<AppError | null>(null);

  const run = useCallback(
    <T>(action: () => Promise<Result<T>>, options: RunOptions<T> = {}) =>
      new Promise<Result<T>>((resolve) => {
        setError(null);
        startTransition(async () => {
          let result: Result<T>;
          try {
            result = await action();
          } catch (err) {
            if (unstable_isUnrecognizedActionError(err)) {
              const message = reloadForNewDeployment()
                ? "Baton was just updated. Reloading the page; please try again."
                : "Baton was just updated. Please refresh the page and try again.";
              result = { ok: false, error: { code: "internal", message, retryable: true } };
            } else {
              result = { ok: false, error: { code: "internal", message: "Something went wrong. Please try again.", retryable: true } };
            }
          }
          if (result.ok) {
            const message = typeof options.success === "function" ? options.success(result.data) : options.success;
            if (message) toast.success(message);
            options.onSuccess?.(result.data);
          } else {
            setError(result.error);
            if (!options.onError?.(result.error)) toast.error(result.error.message);
          }
          resolve(result);
        });
      }),
    [],
  );

  return { run, isPending, error, clearError: () => setError(null) };
}
