"use client";

import { useCallback, useEffect, useRef } from "react";

import type { SaveState } from "@/components/shared/save-state";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { updateHandoverDetailsInput } from "@/lib/contracts/schemas";
import { updateHandoverDetails } from "@/lib/actions/handovers";

import { classifySaveError, detailsInput, sameDetails, type DetailsValues } from "./details-save";

const DEBOUNCE_MS = 800;

const FIELD_MESSAGES: Record<string, string> = {
  title: "Give the handover a title (3–120 characters).",
  teamName: "Add the team or club name (2–120 characters).",
  roleTitle: "Keep the role under 120 characters.",
  description: "Keep the description under 2,000 characters.",
};

interface Options {
  handoverId: string | null;
  /** The newest server `updatedAt` known from outside (create result, a reloaded draft). */
  serverUpdatedAt: string | null;
  /** Values as last saved on the server (to skip no-op saves). */
  savedValues: DetailsValues | null;
  onState: (s: SaveState) => void;
  onFieldErrors: (errors: Record<string, string>) => void;
  onSaved: (h: HandoverSummary, sent: DetailsValues) => void;
  /** Stale `expectedUpdatedAt`: reload the draft from the server. */
  onStale: () => void;
  /** The handover left the draft state. */
  onNotDraft: () => void;
}

/**
 * Debounced, single-flight autosave of a draft's details. Sends the last `updatedAt` it saw and
 * adopts the returned one; at most one request is in flight, and edits made meanwhile are sent
 * right after it (only the latest values). `flush()` saves immediately and resolves to whether
 * everything is saved.
 */
export function useDetailsAutosave(opts: Options) {
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
  });

  const lastSeen = useRef<string | null>(opts.serverUpdatedAt);
  const lastSaved = useRef<DetailsValues | null>(opts.savedValues);
  useEffect(() => {
    if (opts.serverUpdatedAt && (!lastSeen.current || opts.serverUpdatedAt > lastSeen.current)) {
      lastSeen.current = opts.serverUpdatedAt;
      if (opts.savedValues) lastSaved.current = opts.savedValues;
    }
  }, [opts.serverUpdatedAt, opts.savedValues]);

  const queued = useRef<DetailsValues | null>(null);
  const loop = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(async (v: DetailsValues): Promise<boolean> => {
    const id = o.current.handoverId;
    if (!id || !lastSeen.current) return false;
    if (lastSaved.current && sameDetails(v, lastSaved.current)) {
      o.current.onState({ kind: "saved", at: new Date() });
      return true;
    }
    const local = updateHandoverDetailsInput.safeParse(detailsInput(id, v, lastSeen.current));
    if (!local.success) {
      const errors: Record<string, string> = {};
      for (const issue of local.error.issues) {
        const k = String(issue.path[0]);
        errors[k] ??= FIELD_MESSAGES[k] ?? issue.message;
      }
      o.current.onFieldErrors(errors);
      o.current.onState({ kind: "error", message: "Not saved yet: fix the highlighted field." });
      return false;
    }
    o.current.onFieldErrors({});
    o.current.onState({ kind: "saving" });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let r: Awaited<ReturnType<typeof updateHandoverDetails>>;
      try {
        r = await updateHandoverDetails(detailsInput(id, v, lastSeen.current));
      } catch {
        r = { ok: false, error: { code: "internal", message: "Couldn’t reach Baton. Check your connection.", retryable: true } };
      }
      if (r.ok) {
        lastSeen.current = r.data.updatedAt;
        lastSaved.current = v;
        o.current.onSaved(r.data, v);
        o.current.onState({ kind: "saved", at: new Date() });
        return true;
      }
      const f = classifySaveError(r.error);
      if (f.kind === "retry" && attempt === 0) continue;
      if (f.kind === "stale") {
        o.current.onState({ kind: "conflict" });
        o.current.onStale();
      } else if (f.kind === "not_draft") {
        o.current.onNotDraft();
      } else if (f.kind === "fields") {
        o.current.onFieldErrors(f.fieldErrors);
        o.current.onState({ kind: "error", message: "Not saved: fix the highlighted field." });
      } else {
        o.current.onState({ kind: "error", message: f.kind === "fail" ? f.message : r.error.message });
      }
      return false;
    }
    return false;
  }, []);

  const drain = useCallback((): Promise<boolean> => {
    if (!loop.current) {
      loop.current = (async () => {
        let ok = true;
        while (queued.current) {
          const v = queued.current;
          queued.current = null;
          ok = await send(v);
        }
        loop.current = null;
        return ok;
      })();
    }
    return loop.current;
  }, [send]);

  /** Queue the latest values; saved after a short pause in typing. */
  const schedule = useCallback(
    (v: DetailsValues) => {
      queued.current = v;
      o.current.onState({ kind: "dirty" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void drain(), DEBOUNCE_MS);
    },
    [drain],
  );

  /** Save now (Continue, Retry, leaving the step). */
  const flush = useCallback(
    (latest?: DetailsValues) => {
      if (timer.current) clearTimeout(timer.current);
      if (latest) queued.current = latest;
      return drain();
    },
    [drain],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { schedule, flush };
}
