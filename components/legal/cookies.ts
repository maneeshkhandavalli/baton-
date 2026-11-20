import { BROWSER_STORAGE, COOKIES, NON_ESSENTIAL_TRACKING, type StorageCategory } from "./inventory";
import { LEGAL_LAST_UPDATED, type LegalDocumentContent } from "./types";

const CATEGORY_LABEL: Record<StorageCategory, string> = {
  strictly_necessary: "Strictly necessary",
  functional: "Functional, this device only",
};

/** The cookies page (/cookies), generated from the inventory so the tables always match the code. */
export const COOKIES_PAGE: LegalDocumentContent = {
  path: "/cookies",
  title: "Cookies and browser storage",
  summary:
    "Baton uses only the cookies it needs to sign you in and keep the site secure, plus a few settings kept on your device. There is no analytics, advertising or tracking.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "summary",
      heading: "In short",
      blocks: [
        {
          kind: "list",
          items: [
            "Baton sets only strictly necessary cookies: the sign-in session and short-lived security checks.",
            NON_ESSENTIAL_TRACKING.length === 0
              ? "Baton uses no analytics, advertising, social media or other tracking cookies, pixels or scripts."
              : "Baton uses optional tracking, listed below.",
            "A few choices, such as the colour theme, are kept in your browser's local or session storage. They stay on your device and are not sent to Baton's servers or anyone else.",
            "Because nothing optional is set, Baton does not show a cookie banner. If that ever changes, we will ask for your consent first and list the new items here.",
          ],
        },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies",
      blocks: [
        {
          kind: "table",
          caption: "Cookies set by Baton",
          head: ["Name", "Purpose", "Lifetime", "Who gets it", "Type"],
          rows: COOKIES.map((c) => [c.name, c.purpose, c.lifetime, c.who, CATEGORY_LABEL[c.category]]),
        },
        {
          kind: "p",
          text: "Session cookies are marked HttpOnly, so page scripts cannot read them, and Secure on the live site. Signing out or deleting your account removes them.",
        },
      ],
    },
    {
      id: "browser-storage",
      heading: "Local and session storage",
      blocks: [
        {
          kind: "table",
          caption: "Keys Baton keeps in your browser",
          head: ["Key", "Storage", "Purpose", "What it holds", "Lifetime"],
          rows: BROWSER_STORAGE.map((s) => [s.key, s.storage, s.purpose, s.contents, s.lifetime]),
        },
      ],
    },
    {
      id: "third-parties",
      heading: "Third-party requests",
      blocks: [
        {
          kind: "list",
          items: [
            "Fonts are bundled with the site and served from Baton's own domain; your browser does not contact a font service.",
            "Baton loads no third-party scripts, embeds or tracking pixels.",
            "If you choose Sign in with Google, or connect GitHub, Discord or Slack, you are sent to that provider's own site, which applies its own cookies and policies.",
            "Uploads go straight from your browser to Baton's file storage (Supabase) through a single-use link.",
          ],
        },
      ],
    },
    {
      id: "control",
      heading: "Your choices",
      blocks: [
        {
          kind: "p",
          text: "You can clear or block cookies and site data in your browser settings. Blocking the session cookie stops you from signing in; clearing local storage only resets the settings listed above. For questions, contact [Owner to provide: privacy contact email]. More detail is in the privacy notice at /privacy.",
        },
      ],
    },
  ],
};
