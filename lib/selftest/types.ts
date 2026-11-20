/** Shapes of the /test self-check report (plain, serialisable data; never a secret value). */

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckRow {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface CheckSection {
  id: string;
  title: string;
  rows: CheckRow[];
  /** A short note under the section (plain text). */
  note?: string;
}

export interface SelfTestReport {
  generatedAt: string;
  sections: CheckSection[];
  summary: { ok: number; warn: number; fail: number };
}

export type SelfTestEnv = Readonly<Record<string, string | undefined>>;

export const ok = (name: string, detail: string): CheckRow => ({ name, status: "ok", detail });
export const warn = (name: string, detail: string): CheckRow => ({ name, status: "warn", detail });
export const fail = (name: string, detail: string): CheckRow => ({ name, status: "fail", detail });

export function summarise(sections: CheckSection[]): SelfTestReport["summary"] {
  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const s of sections) for (const r of s.rows) summary[r.status] += 1;
  return summary;
}

/** "All good" or "N warnings, M failures" (no em dashes in UI text). */
export function summaryLabel(summary: SelfTestReport["summary"]): string {
  if (summary.warn === 0 && summary.fail === 0) return "All good";
  const parts: string[] = [];
  if (summary.warn > 0) parts.push(`${summary.warn} ${summary.warn === 1 ? "warning" : "warnings"}`);
  if (summary.fail > 0) parts.push(`${summary.fail} ${summary.fail === 1 ? "failure" : "failures"}`);
  return parts.join(", ");
}
