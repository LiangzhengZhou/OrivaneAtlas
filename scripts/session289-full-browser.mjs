import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, writeFileSync } from "node:fs";

const name = process.argv[2];
if (!name || !/^session289-[a-z0-9-]+$/.test(name))
  throw new Error("NEW_PREFIX_REQUIRED");
const prefix = `.artifacts/${name}`;
for (const suffix of [
  ".log",
  "-report.json",
  "-html",
  "-results",
  "-exit.json",
])
  if (existsSync(prefix + suffix)) throw new Error("EVIDENCE_ALREADY_EXISTS");
const log = openSync(`${prefix}.log`, "wx");
const args = [
  "node_modules/@playwright/test/cli.js",
  "test",
  "--workers=2",
  "--reporter=line,json,html",
  `--output=${prefix}-results`,
];
const startedAt = new Date().toISOString();
writeFileSync(
  `${prefix}-command.json`,
  JSON.stringify({
    command: [process.execPath, ...args],
    startedAt,
    platform: process.platform,
    node: process.version,
  }),
  { flag: "wx" },
);
const child = spawn(process.execPath, args, {
  stdio: ["ignore", log, log],
  env: {
    ...process.env,
    ATLAS_BENCHMARK_PREFIX: name,
    PLAYWRIGHT_JSON_OUTPUT_FILE: `${prefix}-report.json`,
    PLAYWRIGHT_HTML_OUTPUT_DIR: `${prefix}-html`,
    PLAYWRIGHT_HTML_OPEN: "never",
  },
});
child.on("exit", (code, signal) => {
  closeSync(log);
  writeFileSync(
    `${prefix}-exit.json`,
    JSON.stringify({
      code,
      signal,
      startedAt,
      endedAt: new Date().toISOString(),
    }),
    { flag: "wx" },
  );
  process.exitCode = code ?? 1;
});
