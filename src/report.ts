import type { Report } from "./api.js";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (t: string) => paint(1, t);
const dim = (t: string) => paint(2, t);

const STATUS = {
  pass: { label: "PASS", code: 32 },
  warning: { label: "WARN", code: 33 },
  fail: { label: "FAIL", code: 31 },
} as const;

export function formatReport(report: Report, dashboardUrl: string): string {
  const lines: string[] = [];
  const counts = { pass: 0, warning: 0, fail: 0 };
  for (const c of report.categories) counts[c.status]++;

  lines.push("", `${bold("Release Readiness")}  ${bold(`${report.readinessScore}/100`)}  ${dim(`${counts.pass} passed · ${counts.warning} warnings · ${counts.fail} failed`)}`, "");
  if (report.summary) lines.push(report.summary, "");

  for (const c of report.categories) {
    const s = STATUS[c.status];
    lines.push(`${paint(s.code, `[${s.label}]`)} ${bold(c.name)}`, `       ${c.message}`);
    if (c.status !== "pass") {
      if (c.details) lines.push(dim(`       ${c.details}`));
      for (const r of c.recommendations) lines.push(`       → ${r}`);
    }
    lines.push("");
  }

  if (report.criticalIssues?.length) {
    lines.push(bold("Critical issues"));
    for (const issue of report.criticalIssues) lines.push(`  • ${issue}`);
    lines.push("");
  }

  lines.push(dim(`Full report: ${dashboardUrl}`));
  return lines.join("\n");
}
