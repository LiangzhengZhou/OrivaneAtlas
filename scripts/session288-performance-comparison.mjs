import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const samples = (directory, prefix) =>
  Array.from({ length: 5 }, (_, index) =>
    JSON.parse(
      readFileSync(
        resolve(
          directory,
          `${prefix}-complete-benchmark-desktop-zh${index ? `-repeat${index}` : ""}.json`,
        ),
        "utf8",
      ),
    ),
  );
const baseline = samples(
  ".artifacts/v24-baseline-361/.artifacts",
  "session127-baseline",
);
const prefix = process.argv[2] ?? "session288-isolated";
if (!/^session288-[a-z0-9-]+$/.test(prefix)) throw new Error("INVALID_PREFIX");
const current = samples(".artifacts", prefix);
const median = (values) =>
  [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ];
const actions = Object.keys(current[0]).filter(
  (key) =>
    current[0][key] &&
    typeof current[0][key] === "object" &&
    ("scriptMs" in current[0][key] || "p95TaskMs" in current[0][key]),
);
const rows = actions.map((action) => {
  const metric = "scriptMs" in current[0][action] ? "scriptMs" : "p95TaskMs";
  const baselineMs = median(baseline.map((sample) => sample[action][metric]));
  const currentMs = median(current.map((sample) => sample[action][metric]));
  return {
    action,
    metric,
    baselineMs,
    currentMs,
    ratio: currentMs / baselineMs,
    pass: currentMs / baselineMs <= 1.1,
  };
});
const report = {
  baseline: "361809f2ed045e5b1e5c2be5809c21f537ec90e4",
  samples: 5,
  threshold: 1.1,
  fixture: current[0].fixture,
  rows,
};
writeFileSync(
  `.artifacts/${prefix}-comparison.json`,
  JSON.stringify(report, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(report, null, 2));
if (rows.some((row) => !row.pass)) process.exitCode = 1;
