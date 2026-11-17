"use client";

/**
 * Participant placeholders (R3 Task 02, PRIV-1). Stored text carries `[PERSON_n]`; inside a handover the
 * PeopleProvider asks the server (resolveHandoverPeople: verified member, clearance checked in SQL,
 * decrypted on the server) for the names this viewer may see. Without a name (no clearance, no provider,
 * still loading, or a person without a usable name) the chip reads "Person n". Names are kept only in this
 * page's memory, never in storage, the URL or a log.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { resolveHandoverPeople } from "@/lib/actions/identity";

import { personPlainLabel } from "./mask-tokens";

const PeopleContext = createContext<ReadonlyMap<number, string>>(new Map());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The handover id from /handover/<id>/…, read after mount (never during prerendering). */
function handoverIdFromLocation(): string | null {
  const m = /^\/handover\/([^/]+)/.exec(window.location.pathname);
  return m && UUID.test(m[1]) ? m[1] : null;
}

export function PeopleProvider({ children }: { children: ReactNode }) {
  const [people, setPeople] = useState<{ handoverId: string; names: ReadonlyMap<number, string> } | null>(null);

  useEffect(() => {
    const handoverId = handoverIdFromLocation();
    if (handoverId === null) return;
    let live = true;
    resolveHandoverPeople({ handoverId })
      .then((result) => {
        if (!live || !result.ok) return;
        const names = new Map<number, string>();
        for (const p of result.data) if (p.label !== null) names.set(p.ordinal, p.label);
        setPeople({ handoverId, names });
      })
      .catch(() => {
        // placeholders stay as "Person n"
      });
    return () => {
      live = false;
    };
  }, []);

  const names = people !== null ? people.names : EMPTY;
  return <PeopleContext.Provider value={names}>{children}</PeopleContext.Provider>;
}

const EMPTY: ReadonlyMap<number, string> = new Map();

export function PersonToken({ ordinal }: { ordinal: number | null }) {
  const names = useContext(PeopleContext);
  const name = ordinal === null ? undefined : names.get(ordinal);
  const fallback = personPlainLabel(ordinal);
  const title =
    name !== undefined
      ? `${name}: shown to members with access. Stored and sent to AI only as ${fallback}.`
      : ordinal === null
        ? "A participant's name was replaced before processing. Baton could not tell which participant was meant."
        : `${fallback}: a participant's name was replaced before processing.`;
  return (
    <span data-token="person" title={title} className="rounded bg-foreground/5 px-1 py-px font-medium">
      {name ?? fallback}
    </span>
  );
}
