/**
 * The legal pages (/privacy, /terms, /cookies): content, metadata, page sources and footer links.
 * Run: node --import ./lib/mocks/__tests__/resolve-ui.mjs --test "components/legal/__tests__/*.test.ts"
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { COOKIES_PAGE } from "../cookies";
import { BROWSER_STORAGE, COOKIES } from "../inventory";
import { LEGAL_PAGES_PUBLISHED } from "../published";
import { legalMetadata } from "../metadata";
import { PRIVACY } from "../privacy";
import { TERMS } from "../terms";
import { legalText, OWNER_PLACEHOLDER, type LegalDocumentContent } from "../types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const DOCS: readonly [LegalDocumentContent, string, string][] = [
  [PRIVACY, "app/(marketing)/privacy/page.tsx", "PRIVACY"],
  [TERMS, "app/(marketing)/terms/page.tsx", "TERMS"],
  [COOKIES_PAGE, "app/(marketing)/cookies/page.tsx", "COOKIES_PAGE"],
];

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

describe("legal pages: content", () => {
  for (const [doc] of DOCS) {
    it(`${doc.path}: has a title, a summary, the last-updated date and unique section ids`, () => {
      assert.ok(doc.title.length > 3 && doc.summary.length > 20);
      assert.equal(doc.lastUpdated, "21 November 2026");
      const ids = doc.sections.map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
      assert.ok(doc.sections.length >= 5);
    });
    it(`${doc.path}: no em or en dashes in any rendered text`, () => {
      for (const t of legalText(doc)) {
        assert.ok(!t.includes(EM_DASH) && !t.includes(EN_DASH), t);
      }
    });
    it(`${doc.path}: no secrets, keys or env-like values in the text`, () => {
      const all = legalText(doc).join("\n");
      assert.doesNotMatch(all, /process\.env|NEXT_PUBLIC_|_API_KEY|_SECRET|sk-[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{10,}|@[a-z0-9-]+\.(?:com|in|org|app)\b/i);
      assert.doesNotMatch(all, /supabase\.co\b/, "no project URL");
    });
  }

  it("/privacy covers every required topic", () => {
    const ids = PRIVACY.sections.map((s) => s.id);
    for (const id of ["what-we-collect", "masking-and-pseudonymisation", "ai-processing", "uploads-and-deletion", "invitation-emails", "subprocessors", "retention", "your-rights"]) {
      assert.ok(ids.includes(id), id);
    }
    const all = legalText(PRIVACY).join("\n");
    assert.match(all, /Omega Plus API/, "names the actual AI provider");
    assert.match(all, /masked and pseudonymised text/);
    assert.match(all, /identity vault/);
    assert.match(all, /gmail\.send/, "the limited Gmail permission");
    assert.match(all, /cannot read, search, delete or change any mailbox/);
    for (const p of ["Vercel", "Supabase", "GitHub", "Discord", "Slack", "Telegram"]) assert.match(all, new RegExp(p));
    assert.match(all, /after 7 days by default/, "the coded raw-retention default");
    assert.match(all, /after 24 hours by default/, "the coded pending-upload grace default");
    assert.match(all, /up to 25 MB/, "MAX_SOURCE_BYTES");
    assert.match(all, /delete your account/);
  });

  it("owner-missing details are clearly marked, never invented", () => {
    const privacy = legalText(PRIVACY).join("\n");
    const terms = legalText(TERMS).join("\n");
    for (const needed of ["privacy contact email", "legal entity name and registered address", "governing law and jurisdiction", "grievance officer"]) {
      assert.match(privacy, new RegExp(`\\[Owner to provide: [^\\]]*${needed}`), needed);
    }
    assert.match(terms, /\[Owner to provide: legal entity name and registered address\]/);
    assert.match(terms, /\[Owner to provide: governing law and jurisdiction\]/);
    for (const doc of [PRIVACY, TERMS, COOKIES_PAGE]) {
      const placeholders = legalText(doc).join("\n").match(OWNER_PLACEHOLDER) ?? [];
      assert.ok(placeholders.length > 0, doc.path);
    }
  });

  it("no compliance claims", () => {
    for (const [doc] of DOCS) {
      assert.doesNotMatch(legalText(doc).join("\n"), /\b(?:fully )?compliant\b|complies with|in compliance with|GDPR[- ]ready|DPDP[- ]ready/i, doc.path);
    }
  });

  it("/cookies says plainly that there is no tracking and no banner, and lists every inventory item", () => {
    const all = legalText(COOKIES_PAGE).join("\n");
    assert.match(all, /no analytics, advertising or tracking/i);
    assert.match(all, /does not show a cookie banner/);
    for (const c of COOKIES) assert.ok(all.includes(c.name), c.name);
    for (const s of BROWSER_STORAGE) assert.ok(all.includes(s.key), s.key);
  });
});

describe("legal pages: metadata and sources", () => {
  for (const [doc, file, constant] of DOCS) {
    it(`${doc.path}: metadata is indexable, titled and described`, () => {
      const m = legalMetadata(doc);
      assert.equal(m.title, doc.title);
      assert.equal(m.description, doc.summary);
      // noindex until the owner details are filled in (LEGAL_PAGES_PUBLISHED, owner decision 21 Nov)
      assert.deepEqual(m.robots, LEGAL_PAGES_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false });
    });
    it(`${doc.path}: the page is static, reads no environment and renders this content`, () => {
      const src = read(file);
      assert.match(src, new RegExp(`export const metadata: Metadata = legalMetadata\\(${constant}\\)`));
      assert.match(src, new RegExp(`<LegalDocument doc=\\{${constant}\\} />`));
      assert.doesNotMatch(src, /process\.env|"use client"|next\/headers|cookies\(\)|headers\(\)|connection\(\)|<script|dangerouslySetInnerHTML/);
    });
  }

  it("the shared components read no environment, set no cookies and load no scripts", () => {
    for (const f of ["components/legal/legal-document.tsx", "components/legal/legal-links.tsx", "components/legal/metadata.ts", "components/legal/inventory.ts", "components/legal/privacy.ts", "components/legal/terms.ts", "components/legal/cookies.ts", "components/legal/types.ts"]) {
      const src = read(f);
      assert.doesNotMatch(src, /process\.env|"use client"|<script|dangerouslySetInnerHTML|localStorage\.|sessionStorage\./, f);
      assert.ok(!src.includes(EM_DASH) && !src.includes(EN_DASH), `${f}: no em or en dashes`);
    }
  });

  it("the legal review note makes no compliance claim and uses no em or en dashes", () => {
    const note = read("docs/legal/LEGAL_REVIEW_NOTE.md");
    assert.ok(!note.includes(EM_DASH) && !note.includes(EN_DASH));
    assert.match(note, /makes no claim that Baton complies with any law/);
    assert.match(note, /Digital Personal Data Protection Act, 2023/);
    assert.match(note, /DPDP Rules, 2025/);
  });

  it("robots.txt does not block the legal pages", () => {
    const robots = read("public/robots.txt");
    for (const p of ["/privacy", "/terms", "/cookies"]) assert.ok(!new RegExp(`^Disallow: ${p}`, "m").test(robots), p);
  });

  it("each document links to the other two", () => {
    const src = read("components/legal/legal-document.tsx");
    assert.match(src, /href: "\/privacy"/);
    assert.match(src, /href: "\/terms"/);
    assert.match(src, /href: "\/cookies"/);
  });
});

describe("legal pages: footer links", () => {
  it("the marketing footer renders the legal links (and nothing else new)", () => {
    const footer = read("components/marketing/marketing-footer.tsx");
    assert.match(footer, /import \{ LegalLinks \} from "@\/components\/legal\/legal-links";/);
    assert.match(footer, /<LegalLinks className="mt-3" \/>/);
  });
  it("LegalLinks points to /privacy, /terms and /cookies", () => {
    const src = read("components/legal/legal-links.tsx");
    for (const [href, label] of [["/privacy", "Privacy"], ["/terms", "Terms"], ["/cookies", "Cookies"]]) {
      assert.match(src, new RegExp(`\\{ href: "${href}", label: "${label}" \\}`));
    }
  });
  it("the three page files exist", () => {
    for (const [, file] of DOCS) assert.ok(existsSync(path.join(root, file)), file);
  });
});
