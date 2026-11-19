"use client";

/**
 * Round 4 (Worker 02): dev-only design previews of the guidance (app/(preview)). The preview layout computes the
 * guidance data from synthetic lib/mocks profiles on the server; this picks one by `?guide=creator|incoming|new`
 * (remembered for the tab, so moving between preview pages keeps it) and never saves anything (persist: false).
 * Without `?guide`, previews show no guidance, as before.
 */

import { useEffect, useState } from "react";

import { GuidanceInit, type GuidanceInitData } from "./guidance";

export type PreviewGuide = "creator" | "incoming" | "new";
const KEY = "baton.preview.guide";

function chosen(): PreviewGuide | null {
  try {
    const q = new URLSearchParams(window.location.search).get("guide");
    if (q === "off") {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    if (q === "creator" || q === "incoming" || q === "new") {
      window.sessionStorage.setItem(KEY, q);
      return q;
    }
    const s = window.sessionStorage.getItem(KEY);
    return s === "creator" || s === "incoming" || s === "new" ? s : null;
  } catch {
    return null;
  }
}

export function PreviewGuidanceInit({ options }: { options: Record<PreviewGuide, GuidanceInitData> }) {
  const [guide, setGuide] = useState<PreviewGuide | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the choice lives in the URL/sessionStorage (client only)
  useEffect(() => setGuide(chosen()), []);
  return guide ? <GuidanceInit data={options[guide]} /> : null;
}
