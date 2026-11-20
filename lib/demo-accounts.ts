/**
 * Shared demo accounts for hackathon judges (client-safe; NEXT_PUBLIC values are inlined at build time).
 *
 * NEXT_PUBLIC_BATON_DEMO_{CREATOR,INCOMING}_{EMAIL,PASSWORD} are public BY DESIGN: the sign-in page shows them so
 * judges can use a ready-made account with synthetic data. An account is offered only when both its email and
 * its password are set; with nothing set, the sign-in page shows no demo panel.
 *
 * Because anyone can sign in to them, demo accounts may not delete themselves, change their password or email,
 * or erase participants. The server checks isDemoAccountEmail() on every such action. BATON_DEMO_EMAILS
 * (server-only, comma-separated, case-insensitive) lists further demo addresses; the two public emails above
 * always count as demo accounts too.
 */

export type DemoAccountRole = "creator" | "incoming";

export interface DemoAccount {
  role: DemoAccountRole;
  /** The button text. */
  label: string;
  email: string;
  password: string;
}

export interface DemoAccountEnv {
  creatorEmail?: string | undefined;
  creatorPassword?: string | undefined;
  incomingEmail?: string | undefined;
  incomingPassword?: string | undefined;
}

export const DEMO_ACCOUNT_REFUSAL = "This is a shared demo account, so this action is turned off.";

/**
 * Owner decision 21 Nov (judging): the judge demo accounts can do everything an ordinary account can (upload,
 * process with AI, create and delete handovers, connect Slack/Discord/Telegram/GitHub, add points and questions,
 * email invitations, set a display name). Only the two shared-account safety blocks stay: changing the password
 * and deleting the account, so one judge can't lock the others out. Set to false to restore the F3 content limits.
 */
export const DEMO_ACCOUNTS_FULL_ACCESS = true;

/**
 * F3 (21 Nov): the shared demo accounts are public, so they may explore, review, publish and acknowledge the seeded
 * handovers, but may not add content or spend on AI: no new handovers, uploads, new source versions, consent to new
 * sources, processing runs, revisions, or deletions. Enforced in the server actions (all writes go through them;
 * the authenticated role has no table write grants). Remove together with the demo panel after judging.
 */
export const DEMO_CONTENT_REFUSAL =
  "Demo accounts can explore, review and publish the sample handovers, but can't add files, points or questions, start AI processing or create new handovers. Create your own account to try that, or use the no-sign-in demo.";

const clean = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

/** The demo accounts to offer, in order (creator first). An account needs an email with "@" and a password. */
export function parseDemoAccounts(env: DemoAccountEnv): DemoAccount[] {
  const out: DemoAccount[] = [];
  const add = (role: DemoAccountRole, label: string, email: string | undefined, password: string | undefined) => {
    const e = clean(email);
    const p = typeof password === "string" ? password : "";
    if (e.includes("@") && p.trim().length > 0) out.push({ role, label, email: e, password: p });
  };
  add("creator", "Sign in as the handover creator", env.creatorEmail, env.creatorPassword);
  add("incoming", "Sign in as the incoming member", env.incomingEmail, env.incomingPassword);
  return out;
}

/** Literal process.env reads, so Next.js inlines them into the browser bundle. */
function publicDemoEnv(): DemoAccountEnv {
  return {
    creatorEmail: process.env.NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL,
    creatorPassword: process.env.NEXT_PUBLIC_BATON_DEMO_CREATOR_PASSWORD,
    incomingEmail: process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL,
    incomingPassword: process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_PASSWORD,
  };
}

/** The demo accounts configured for this build (empty when none are set). */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = parseDemoAccounts(publicDemoEnv());

/** BATON_DEMO_EMAILS: comma-separated, trimmed, lower-cased; empty entries dropped. */
export function parseDemoEmailList(raw: string | undefined): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export interface DemoGuardEnv {
  BATON_DEMO_EMAILS?: string | undefined;
  NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL?: string | undefined;
  NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL?: string | undefined;
}

/** Every address treated as a shared demo account (lower-cased). */
export function demoAccountEmails(env: DemoGuardEnv): Set<string> {
  const set = new Set(parseDemoEmailList(env.BATON_DEMO_EMAILS));
  for (const e of [env.NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL, env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL]) {
    const v = clean(e).toLowerCase();
    if (v.includes("@")) set.add(v);
  }
  return set;
}

function currentGuardEnv(): DemoGuardEnv {
  return {
    BATON_DEMO_EMAILS: process.env.BATON_DEMO_EMAILS,
    NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL: process.env.NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL,
    NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL: process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL,
  };
}

/** Server-side check (reads the environment at call time). Null or empty emails are never demo accounts. */
export function isDemoAccountEmail(email: string | null | undefined, env: DemoGuardEnv = currentGuardEnv()): boolean {
  const e = clean(email ?? undefined).toLowerCase();
  if (!e) return false;
  return demoAccountEmails(env).has(e);
}
