"use client";

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
          } catch {
            result = { ok: false, error: { code: "internal", message: "Something went wrong. Please try again.", retryable: true } };
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
