import { SectionHeading } from "@/components/shared/section-heading";
import { Badge } from "@/components/ui/badge";
import type { CheckStatus, SelfTestReport } from "@/lib/selftest/types";
import { summaryLabel } from "@/lib/selftest/types";

const TONE: Record<CheckStatus, "success" | "warning" | "danger"> = { ok: "success", warn: "warning", fail: "danger" };
const LABEL: Record<CheckStatus, string> = { ok: "OK", warn: "WARN", fail: "FAIL" };

export function StatusBadge({ status }: { status: CheckStatus }) {
  return (
    <Badge tone={TONE[status]} size="sm" dot>
      {LABEL[status]}
    </Badge>
  );
}

/** The owner self-check report: one summary line, then one simple section per area (server-safe, no hooks). */
export function SelfTestReportView({ report }: { report: SelfTestReport }) {
  const { summary } = report;
  const overall: CheckStatus = summary.fail > 0 ? "fail" : summary.warn > 0 ? "warn" : "ok";
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-6" role="status">
        <StatusBadge status={overall} />
        <p className="type-heading text-foreground">{summaryLabel(summary)}</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {summary.ok} passed · checked at {report.generatedAt}
        </p>
      </div>
      {report.sections.map((section) => (
        <section key={section.id} aria-labelledby={`selftest-${section.id}`} className="space-y-3">
          <SectionHeading id={`selftest-${section.id}`} title={section.title} description={section.note} />
          <ul className="divide-y divide-border border-y border-border">
            {section.rows.map((row, i) => (
              <li key={`${row.name}-${i}`} className="grid gap-1 py-2.5 sm:grid-cols-[14rem_4.5rem_1fr] sm:items-baseline sm:gap-4">
                <span className="text-sm font-medium text-foreground">{row.name}</span>
                <span>
                  <StatusBadge status={row.status} />
                </span>
                <span className="text-sm break-words text-muted-foreground">{row.detail}</span>
              </li>
            ))}
            {section.rows.length === 0 ? <li className="py-2.5 text-sm text-muted-foreground">No checks in this section.</li> : null}
          </ul>
        </section>
      ))}
    </div>
  );
}
