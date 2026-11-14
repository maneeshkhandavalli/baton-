"use client";

import { useState } from "react";

import { chat, samplePoint } from "../_shared/content";
import "./d.css";

/** Concept-scoped class names (plain CSS; this project's Tailwind CSS loader does not support CSS Modules). */
const s = new Proxy({} as Record<string, string>, { get: (_t, k) => `ld-${String(k)}` });

/**
 * The hero's one interaction: the same record seen as the raw chat or as the handover point Baton drafts from
 * it. It demonstrates the product's transformation rather than decorating the page.
 */
export function ChatHandoverToggle() {
  const [view, setView] = useState<"chat" | "handover">("handover");
  return (
    <div className="w-full max-w-[520px]">
      <div role="group" aria-label="View the record as" className="inline-flex rounded-full border border-[var(--line)] bg-[var(--bg)] p-1 font-[family-name:var(--d-mono)] text-[11px] uppercase">
        {(["chat", "handover"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`${s.toggleBtn} rounded-full px-4 py-1.5 tracking-[0.08em] text-[var(--dim)] transition-colors hover:text-[var(--bone)]`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className={`${s.panelSwap} mt-4`}>
        <div aria-hidden={view !== "chat"} className={`${view === "chat" ? "" : s.hidden} rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5`}>
          <ul className="space-y-3 font-[family-name:var(--d-mono)] text-[12px] leading-relaxed">
            {[chat[1], chat[2], chat[4]].map((m) => (
              <li key={m.t}>
                <span className="text-[var(--dim)]">{m.t}, {m.who}: </span>
                {m.text}
              </li>
            ))}
            <li>
              <span className="text-[var(--dim)]">{samplePoint.sentAt}, {samplePoint.author}: </span>
              {samplePoint.quoteBefore}
              <span className="rounded bg-[var(--bone)] px-1 text-[var(--bg)]">{samplePoint.quoteMask}</span>
            </li>
          </ul>
        </div>
        <div aria-hidden={view !== "handover"} className={`${view === "handover" ? "" : s.hidden} rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5`}>
          <div className="flex items-center gap-2 font-[family-name:var(--d-mono)] text-[11px] uppercase">
            <span className="rounded-full bg-[var(--acid)] px-2 py-0.5 text-[var(--bg)]">Sourced</span>
            <span className="text-[var(--dim)]">{samplePoint.category}</span>
          </div>
          <p className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{samplePoint.title}</p>
          <p className="mt-1 text-[15px] text-[var(--dim)]">{samplePoint.summary}</p>
          <p className="mt-4 border-l-2 border-[var(--acid)] pl-3 font-[family-name:var(--d-mono)] text-[12px] leading-relaxed">
            {samplePoint.quoteBefore}
            <span className="rounded bg-[var(--bone)] px-1 text-[var(--bg)]">{samplePoint.quoteMask}</span>
          </p>
          <p className="mt-3 font-[family-name:var(--d-mono)] text-[11px] text-[var(--dim)]">
            {samplePoint.author}, {samplePoint.sentAt}, {samplePoint.source}
          </p>
        </div>
      </div>
    </div>
  );
}
