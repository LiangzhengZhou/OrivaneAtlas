import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const prefix = process.argv[2];
if (!prefix || !/^[a-zA-Z0-9-]+$/.test(prefix))
  throw new Error("EXPLICIT_NEW_COHORT_PREFIX_REQUIRED");
const accepted = JSON.parse(
  readFileSync("docs/benchmarks/v3-phase7-interaction.json", "utf8"),
);
const baselineFiles = accepted.files.baseline;
const currentFiles = Array.from(
  { length: 20 },
  (_, index) =>
    `${prefix}-complete-benchmark-desktop-zh${index ? `-repeat${index}` : ""}.json`,
);
const read = (directory, files) =>
  files.map((file) =>
    JSON.parse(readFileSync(resolve(directory, file), "utf8")),
  );
const baseline = read(".artifacts/v3-baseline-a9dc/.artifacts", baselineFiles);
const current = read(".artifacts", currentFiles);
if (baseline.length !== 20 || current.length !== 20)
  throw new Error("ALL_TWENTY_SAMPLES_REQUIRED");
const median = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  return (ordered[9] + ordered[10]) / 2;
};
const rows = accepted.rows.map(({ action, metric }) => {
  const values = (cohort) =>
    cohort.map((sample) => {
      const value = sample[action]?.[metric];
      if (!Number.isFinite(value) || value < 0)
        throw new Error("INVALID_SAMPLE");
      return value;
    });
  const before = values(baseline),
    after = values(current);
  const baselineMs = median(before),
    currentMs = median(after);
  return {
    action,
    metric,
    baselineMs,
    currentMs,
    regressionPercent: (currentMs / baselineMs - 1) * 100,
    baselineRangeMs: [Math.min(...before), Math.max(...before)],
    currentRangeMs: [Math.min(...after), Math.max(...after)],
    pass: currentMs <= baselineMs * 1.1,
  };
});
const report = {
  baselineSha: accepted.baselineSha,
  protocol:
    "Existing Phase7 trace-off; equal trusted input and settlement; unchanged 20-sample median/10% budget",
  samplesPerBuild: 20,
  threshold: 1.1,
  baselineFiles,
  currentFiles,
  rows,
};
writeFileSync(
  `.artifacts/${prefix}-comparison.json`,
  JSON.stringify(report, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(report, null, 2));
if (rows.some((row) => !row.pass)) process.exitCode = 1;
