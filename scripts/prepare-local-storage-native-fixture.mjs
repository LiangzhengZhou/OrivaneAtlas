import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

execFileSync(
  process.execPath,
  ["scripts/build-local-storage-fixture.mjs", "0"],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);
const output = resolve(".artifacts/android-local-storage/assets");
mkdirSync(output, { recursive: true });
copyFileSync(
  resolve(".artifacts/local-storage-fixture-0/storage.js"),
  resolve(output, "storage.js"),
);
copyFileSync(
  resolve("tests/native/local-storage-probe.js"),
  resolve(output, "probe.js"),
);
