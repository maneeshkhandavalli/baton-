import type { Metadata } from "next";
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  Funnel_Display,
  Funnel_Sans,
  Host_Grotesk,
  Hubot_Sans,
  IBM_Plex_Mono,
  Martian_Mono,
  Mona_Sans,
} from "next/font/google";
import { notFound } from "next/navigation";

import palettes from "./palettes.json";
import "./palettes.css";
import "./directions.css";

export const metadata: Metadata = { title: "Identity directions", robots: { index: false, follow: false } };

/**
 * DESIGN LAB ONLY: 404 outside development. Three identity directions (palette + type pairing) applied to the same
 * hero composition and the same app components, light and dark side by side. Content: the fictional CodeCell demo
 * (Priya Raman hands over to Neha Kulkarni; Kabir Shah reviews). See docs/design/AI-SLOP-AUDIT.md.
 */

const host = Host_Grotesk({ subsets: ["latin"], variable: "--f-host", display: "swap" });
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--f-atk", display: "swap" });
const atkMono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--f-atkm", display: "swap" });
const funnelD = Funnel_Display({ subsets: ["latin"], variable: "--f-fund", display: "swap" });
const funnelS = Funnel_Sans({ subsets: ["latin"], variable: "--f-funs", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-plex", display: "swap" });
const hubot = Hubot_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--f-hubot", display: "swap" });
const mona = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--f-mona", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--f-martian", display: "swap" });

type Key = keyof typeof palettes;

const DIRECTIONS: { key: Key; title: string; type: string; fonts: [string, string, string]; why: string }[] = [
  {
    key: "highlighter",
    title: "1 · Graphite & Highlighter",
    type: "Host Grotesk · Atkinson Hyperlegible Next · Atkinson Hyperlegible Mono",
    fonts: ["var(--f-host)", "var(--f-atk)", "var(--f-atkm)"],
    why: "Ink-on-paper neutrals with one highlighter: the colour of marking the line in a record that matters. It appears only where Baton points at evidence (the quoted line, the source reference, focus). Atkinson was drawn for low-vision legibility: the next person has to be able to read the handover.",
  },
  {
    key: "oxblood",
    title: "2 · Paper & Oxblood",
    type: "Funnel Display · Funnel Sans · IBM Plex Mono",
    fonts: ["var(--f-fund)", "var(--f-funs)", "var(--f-plex)"],
    why: "Oxblood is the colour of a wax seal: the sign-off and acknowledgement that close a handover. Funnel is a display/text pair designed together, so headings and UI share proportions without being one face.",
  },
  {
    key: "moss",
    title: "3 · Slate & Moss",
    type: "Hubot Sans · Mona Sans · Martian Mono",
    fonts: ["var(--f-hubot)", "var(--f-mona)", "var(--f-martian)"],
    why: "Cool slate with moss as the single colour of approval: the brand colour is the colour of 'a person checked this'. Hubot/Mona/Martian share width axes, so dense app screens can tighten without a new family.",
  },
];

function Panel({ d, theme }: { d: (typeof DIRECTIONS)[number]; theme: "light" | "dark" }) {
  const p = palettes[d.key][theme];
  return (
    <section
      className={`dl-panel dl-${d.key} dl-${theme}`}
      style={{ "--dl-display": d.fonts[0], "--dl-text": d.fonts[1], "--dl-mono": d.fonts[2] } as React.CSSProperties}
      aria-label={`${d.title}, ${theme}`}
    >
      <div className="dl-meta">
        <span>{d.title}</span>
        <span>{theme}</span>
      </div>

      {/* Hero composition */}
      <h2 className="dl-h1">Hand over a project without losing what matters.</h2>
      <p className="dl-sub">Baton turns a team&rsquo;s WhatsApp chats and documents into a handover where every point links to the message it came from.</p>
      <div className="dl-actions">
        <span className="dl-btn dl-btn--primary">Start a handover</span>
        <span className="dl-btn dl-btn--secondary">Try the demo</span>
      </div>
      <div className="dl-flow">
        <div className="dl-msg">
          <p className="dl-msg-head">Priya Raman · 2 Nov 2026, 16:00 · Core Team 26-27</p>
          <p className="dl-msg-text">
            <span className="dl-hl">github org owners are me and kabir.</span> recovery codes are in the club password manager, not in chat. i&rsquo;ll add
            neha as owner before i go
          </p>
        </div>
        <span className="dl-arrow">becomes →</span>
        <div className="dl-point">
          <div className="dl-row">
            <span className="dl-tag dl-tag--sourced">
              <i />
              Sourced
            </span>
            <span className="dl-hint">Account &amp; access</span>
          </div>
          <p className="dl-point-title">GitHub organisation owners</p>
          <p className="dl-point-stmt">Priya and Kabir own codecell-org. Priya adds Neha before she leaves.</p>
          <p className="dl-ref">↳ Core Team 26-27 · line 41</p>
        </div>
      </div>

      <p className="dl-section-label">Surfaces</p>
      <div className="dl-surfaces">
        <div style={{ background: "var(--bg)" }}>bg {p.bg}</div>
        <div style={{ background: "var(--s1)" }}>s1 {p.s1}</div>
        <div style={{ background: "var(--s2)" }}>s2 {p.s2}</div>
        <div style={{ background: "var(--s3)" }}>s3 {p.s3}</div>
      </div>

      <p className="dl-section-label">Buttons</p>
      <div className="dl-row">
        <span className="dl-btn dl-btn--primary">Publish</span>
        <span className="dl-btn dl-btn--secondary">Preview</span>
        <span className="dl-btn dl-btn--ghost">Back</span>
        <span className="dl-btn dl-btn--approve">Approve</span>
        <span className="dl-btn dl-btn--danger">Reject</span>
      </div>

      <p className="dl-section-label">Form field</p>
      <div className="dl-field">
        <label htmlFor={`f-${d.key}-${theme}`}>Who is taking over?</label>
        <input id={`f-${d.key}-${theme}`} className="dl-input" defaultValue="Neha Kulkarni" />
        <span className="dl-hint">They read the handover and acknowledge it.</span>
      </div>

      <p className="dl-section-label">Evidence and status</p>
      <div className="dl-row">
        <span className="dl-tag dl-tag--sourced">
          <i />
          Sourced
        </span>
        <span className="dl-tag dl-tag--inferred">
          <i />
          Inferred
        </span>
        <span className="dl-tag dl-tag--conflicting">
          <i />
          Conflicting
        </span>
        <span className="dl-tag dl-tag--missing">
          <i />
          Missing
        </span>
        <span className="dl-pill">Approved by Kabir</span>
        <span className="dl-pill dl-pill--warn">In review</span>
        <span className="dl-pill dl-pill--soft">Published</span>
      </div>

      <p className="dl-section-label">Dashboard rows</p>
      <div className="dl-list">
        <div className="dl-list-row is-selected">
          <span className="dl-list-title">CodeCell technical lead</span>
          <span className="dl-pill dl-pill--warn">In review</span>
          <span className="dl-list-meta">Priya Raman → Neha Kulkarni · 6 to review</span>
        </div>
        <div className="dl-list-row">
          <span className="dl-list-title">NSS volunteer coordinator</span>
          <span className="dl-pill dl-pill--soft">Published</span>
          <span className="dl-list-meta">Acknowledged 12 Nov</span>
        </div>
      </div>

      <p className="dl-section-label">Accent and semantic</p>
      <div className="dl-swatches">
        {(["accent", "accentInk", "success", "warning", "danger", "sourced", "inferred", "conflicting", "missing"] as const).map((k) => (
          <div key={k} className="dl-swatch">
            <span style={{ background: p[k] }} />
            {k} {p[k]}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Directions() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className={`${host.variable} ${atkinson.variable} ${atkMono.variable} ${funnelD.variable} ${funnelS.variable} ${plexMono.variable} ${hubot.variable} ${mona.variable} ${martian.variable}`}>
      {DIRECTIONS.map((d) => (
        <div key={d.key} id={d.key}>
          <div style={{ padding: "1.5rem 2rem", background: "#e9e9e6", color: "#18181b", fontFamily: "system-ui", fontSize: 14 }}>
            <strong>{d.title}</strong> · {d.type}
            <p style={{ margin: "0.4rem 0 0", maxWidth: "90ch" }}>{d.why}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 560px), 1fr))" }}>
            <Panel d={d} theme="light" />
            <Panel d={d} theme="dark" />
          </div>
        </div>
      ))}
    </main>
  );
}
