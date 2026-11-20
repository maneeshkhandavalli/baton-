/**
 * The cookie and browser-storage inventory behind /cookies and /privacy, taken from the code on 21 November 2026.
 * components/legal/__tests__/inventory.test.ts scans the source tree: a new localStorage or sessionStorage user, or a
 * new cookie constant, that is not listed here fails the test, so the published pages cannot drift from the code.
 *
 * Categories:
 *   strictly_necessary  needed to provide what the person asked for (signing in, security);
 *   functional          remembers a choice or an unsent draft on this device only; never sent to Baton's servers
 *                       or to anyone else, and never used to track or profile anyone.
 * There is no analytics, advertising or tracking storage (no consent banner is needed for it; see /cookies).
 */

export type StorageCategory = "strictly_necessary" | "functional";

export interface CookieEntry {
  /** The cookie name as the browser shows it. */
  name: string;
  /** A literal that appears in the source that sets it (checked by the test), or null for library cookies. */
  sourceLiteral: string | null;
  /** Repository files that set it. */
  setIn: readonly string[];
  purpose: string;
  lifetime: string;
  who: string;
  category: StorageCategory;
}

export interface BrowserStorageEntry {
  /** The key as stored (a pattern when it includes an id). */
  key: string;
  /** A literal that appears in the source (checked by the test). */
  sourceLiteral: string;
  storage: "localStorage" | "sessionStorage";
  /** Repository files that read or write it. */
  usedIn: readonly string[];
  purpose: string;
  contents: string;
  lifetime: string;
  category: StorageCategory;
}

export const COOKIES: readonly CookieEntry[] = [
  {
    name: "sb-<project>-auth-token (may be split into .0, .1, ...)",
    sourceLiteral: null,
    setIn: ["lib/supabase/server.ts", "lib/supabase/proxy.ts", "lib/supabase/cookie-options.ts"],
    purpose: "Keeps you signed in. Set by Supabase Auth when you sign in with Google or an email link or password.",
    lifetime: "Up to 400 days, renewed while you use Baton; the session itself ends earlier under Supabase Auth rules and when you sign out.",
    who: "Signed-in users",
    category: "strictly_necessary",
  },
  {
    name: "sb-<project>-auth-token-code-verifier",
    sourceLiteral: null,
    setIn: ["lib/supabase/server.ts", "lib/supabase/cookie-options.ts"],
    purpose: "Security check that links the start of a sign-in to its finish (PKCE).",
    lifetime: "Removed when the sign-in completes or fails.",
    who: "Anyone signing in",
    category: "strictly_necessary",
  },
  {
    name: "baton_selftest_ai_at",
    sourceLiteral: "baton_selftest_ai_at",
    setIn: ["lib/selftest/actions.ts"],
    purpose: "Rate limit for the owner-only diagnostics page (/test): records when its live AI check last ran.",
    lifetime: "2 minutes; only on the /test path.",
    who: "The site owner only",
    category: "strictly_necessary",
  },
  {
    name: "baton_gmail_oauth",
    sourceLiteral: "baton_gmail_oauth",
    setIn: ["lib/email/gmail-core.ts", "lib/email/gmail-routes.ts"],
    purpose: "Security check (against cross-site request forgery) while the site owner connects the Gmail account that sends invitation emails.",
    lifetime: "10 minutes, or until the connection finishes; only on the /api/email/google path.",
    who: "The site owner only",
    category: "strictly_necessary",
  },
];

export const BROWSER_STORAGE: readonly BrowserStorageEntry[] = [
  {
    key: "baton-theme",
    sourceLiteral: "baton-theme",
    storage: "localStorage",
    usedIn: ["lib/theme.ts", "public/theme-init.js"],
    purpose: "Remembers whether you chose the light or dark theme.",
    contents: "\"light\" or \"dark\"",
    lifetime: "Until you clear it in your browser.",
    category: "functional",
  },
  {
    key: "baton:intro-seen",
    sourceLiteral: "baton:intro-seen",
    storage: "sessionStorage",
    usedIn: ["public/intro-splash-init.js", "components/marketing/intro-splash.tsx"],
    purpose: "Shows the short intro animation on the home page only once per tab.",
    contents: "\"1\"",
    lifetime: "Until the tab is closed.",
    category: "functional",
  },
  {
    key: "baton.gettingStarted.collapsed",
    sourceLiteral: "baton.gettingStarted.collapsed",
    storage: "localStorage",
    usedIn: ["components/onboarding/getting-started.tsx"],
    purpose: "Remembers whether you collapsed the Getting started panel.",
    contents: "\"1\" or \"0\"",
    lifetime: "Until you clear it in your browser.",
    category: "functional",
  },
  {
    key: "baton.preview.guide",
    sourceLiteral: "baton.preview.guide",
    storage: "sessionStorage",
    usedIn: ["components/onboarding/preview-guidance.tsx"],
    purpose: "Remembers which guided preview you picked on the preview pages.",
    contents: "\"creator\", \"incoming\" or \"new\"",
    lifetime: "Until the tab is closed.",
    category: "functional",
  },
  {
    key: "baton:first-week:<publication id>",
    sourceLiteral: "baton:first-week:",
    storage: "localStorage",
    usedIn: ["components/published/first-week.ts", "components/published/published-handover-view.tsx"],
    purpose: "Remembers which items of a published handover's first-week checklist you ticked, on this device only.",
    contents: "A list of checklist item ids",
    lifetime: "Until you clear it in your browser.",
    category: "functional",
  },
  {
    key: "baton:gap-draft:<start of the link token>",
    sourceLiteral: "baton:gap-draft:",
    storage: "localStorage",
    usedIn: ["components/gap-interview/gap-interview.tsx"],
    purpose: "Keeps your unsent Gap Interview answers if the page reloads.",
    contents: "Your draft answers",
    lifetime: "Deleted when you submit; otherwise until you clear it in your browser.",
    category: "functional",
  },
  {
    key: "baton:gap-sent:<start of the link token>",
    sourceLiteral: "baton:gap-sent:",
    storage: "localStorage",
    usedIn: ["components/gap-interview/gap-interview.tsx", "components/gap-interview/sent-questions.ts"],
    purpose: "Remembers which Gap Interview questions you already answered on this device, so a partly finished interview shows only the questions still open.",
    contents: "The ids of the questions you sent (never your answers)",
    lifetime: "Until you clear it in your browser.",
    category: "functional",
  },
  {
    key: "baton:wizard-consent:<handover id>",
    sourceLiteral: "baton:wizard-consent:",
    storage: "sessionStorage",
    usedIn: ["components/wizard/consent-state.ts", "components/wizard/new-handover-wizard.tsx"],
    purpose:
      "Keeps the ticks on the new-handover consent checklist if the page reloads. This is draft screen state only: it is not your consent and is never sent to Baton. Consent is recorded on the server only when you upload a source with the full checklist ticked.",
    contents: "Three true or false ticks for one draft handover",
    lifetime: "Until you close the tab; removed when every tick is cleared.",
    category: "functional",
  },
  {
    key: "baton.demo.v1",
    sourceLiteral: "baton.demo.v1",
    storage: "sessionStorage",
    usedIn: ["components/demo/demo-guide.ts", "components/demo/demo-workspace.tsx", "lib/demo/engine/index.ts"],
    purpose: "Holds your progress in the interactive demo, which runs entirely in your browser with made-up data.",
    contents: "Demo progress only (fictional data)",
    lifetime: "Until the tab is closed.",
    category: "functional",
  },
];

/** Analytics, advertising and tracking: none exists in the code (asserted by the tests). */
export const NON_ESSENTIAL_TRACKING: readonly string[] = [];
