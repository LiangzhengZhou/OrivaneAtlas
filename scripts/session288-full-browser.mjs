import { spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";

const prefix = ".artifacts/session288-reminder-fixed-full-browser";
const log = openSync(`${prefix}.log`, "wx");
const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--workers=2",
    "--reporter=line,json",
    `--output=${prefix}-results`,
  ],
  {
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      ATLAS_BENCHMARK_PREFIX: "session288-reminder-fixed-full-browser",
      PLAYWRIGHT_JSON_OUTPUT_FILE: `${prefix}-report.json`,
    },
  },
);
child.on("exit", (code, signal) => {
  closeSync(log);
  writeFileSync(`${prefix}-exit.json`, JSON.stringify({ code, signal }));
  process.exitCode = code ?? 1;
});
