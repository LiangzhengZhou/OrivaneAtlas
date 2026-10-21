import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";

const titles = JSON.parse(
  readFileSync(".artifacts/session287-historical-failure-titles.json", "utf8"),
);
const prefix = ".artifacts/session287-current-historical";
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const log = openSync(`${prefix}.log`, "wx");
const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--project=desktop-en",
    "--workers=1",
    "--grep",
    titles.map(escape).join("|"),
    "--reporter=line,json",
    `--output=${prefix}-results`,
  ],
  {
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: `${prefix}-report.json`,
    },
  },
);
child.on("exit", (code, signal) => {
  closeSync(log);
  writeFileSync(`${prefix}-exit.json`, JSON.stringify({ code, signal }));
  process.exitCode = code ?? 1;
});
