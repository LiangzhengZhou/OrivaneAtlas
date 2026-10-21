import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const accepted = JSON.parse(
  readFileSync("docs/benchmarks/v3-phase7-interaction.json", "utf8"),
);
const baselineDirectory = ".artifacts/v3-baseline-a9dc/.artifacts";
const baseline = accepted.files.baseline.map((name) =>
  JSON.parse(readFileSync(resolve(baselineDirectory, name), "utf8")),
);
const currentFiles = Array.from(
  { length: 20 },
  (_, index) =>
    `session288-formal-complete-benchmark-desktop-zh${index ? `-repeat${index}` : ""}.json`,
);
const current = currentFiles.map((name) =>
  JSON.parse(readFileSync(resolve(".artifacts", name), "utf8")),
);
if (baseline.length !== 20 || current.length !== 20)
  throw new Error("ALL_TWENTY_SAMPLES_REQUIRED");
const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  return (ordered[9] + ordered[10]) / 2;
};
const rows = accepted.rows.map(({ action, metric }) => {
  const values = (samples) =>
    samples.map((sample) => {
      const value = sample[action]?.[metric];
      if (!Number.isFinite(value) || value < 0)
        throw new Error("INVALID_SAMPLE");
      return value;
    });
  const before = values(baseline);
  const after = values(current);
  const baselineMs = median(before);
  const currentMs = median(after);
  return {
    action,
    metric,
    baselineMs,
    currentMs,
    ratio: currentMs / baselineMs,
    pass: currentMs <= baselineMs * 1.1,
  };
});
const report = {
  baselineSha: accepted.baselineSha,
  protocol: "Existing Phase7 trace-off input/settlement; current cohort serial",
  baselineCollection: accepted.collectionOrder,
  samplesPerBuild: 20,
  threshold: 1.1,
  currentFiles,
  baselineFiles: accepted.files.baseline,
  rows,
  liveDOM: current.map((sample) => ({
    list: sample.liveListRows,
    board: sample.liveBoardRows,
    sessions: sample.liveSessionRows,
  })),
};
writeFileSync(
  ".artifacts/session288-formal-comparison.json",
  JSON.stringify(report, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(report, null, 2));
if (rows.some((row) => !row.pass)) process.exitCode = 1;
