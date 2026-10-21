import { readFileSync, writeFileSync } from "node:fs";

const source = ".artifacts/session285-full-final-report.json";
const report = JSON.parse(readFileSync(source, "utf8"));
const cases = [];
function visit(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      cases.push({
        id: test.testId,
        title: spec.title,
        file: spec.file,
        line: spec.line,
        project: test.projectName,
        status: test.status,
        attempts: results.map((result) => ({
          status: result.status,
          errors: result.errors,
          attachments: result.attachments,
        })),
        classification:
          test.status === "expected"
            ? "PASS"
            : "UNCLASSIFIED_PENDING_ROOT_CAUSE",
      });
    }
  }
  for (const child of suite.suites ?? []) visit(child);
}
visit(report);
const evidence = {
  source,
  originalCommand: report.config.argv,
  stats: report.stats,
  discovered: cases.length,
  executed: cases.filter((entry) => entry.attempts.length).length,
  interrupted: cases.filter((entry) =>
    entry.attempts.some((result) => result.status === "interrupted"),
  ).length,
  projects: Object.fromEntries(
    [...new Set(cases.map((entry) => entry.project))].map((project) => [
      project,
      {
        total: cases.filter((entry) => entry.project === project).length,
        pass: cases.filter(
          (entry) => entry.project === project && entry.status === "expected",
        ).length,
        fail: cases.filter(
          (entry) => entry.project === project && entry.status === "unexpected",
        ).length,
      },
    ]),
  ),
  exitCode:
    "Not persisted by original launcher; complete report and last-run status prove failed run, not its numeric shell exit code",
  cases,
};
writeFileSync(
  ".artifacts/session286-recovered-browser-audit.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify({ ...evidence, cases: undefined }, null, 2));
