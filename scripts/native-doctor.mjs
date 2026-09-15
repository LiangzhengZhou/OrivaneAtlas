import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.connected.conf.json", import.meta.url),
  ),
);
const capability = JSON.parse(
  readFileSync(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
  ),
);
assert.equal(new URL(config.build.frontendDist).protocol, "https:");
assert.equal(config.build.devUrl, config.build.frontendDist);
assert.equal(config.app.withGlobalTauri, false);
assert.deepEqual(config.app.security.capabilities, [capability.identifier]);
assert.deepEqual(capability.permissions, []);
assert.equal(capability.remote, undefined);
console.log(
  "Connected configuration safety checks passed. No remote IPC permissions.",
);
let ready = process.platform === "win32";
for (const command of ["cargo", "rustc"]) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const available = result.status === 0;
  console.log(
    command +
      ": " +
      (available ? result.stdout.trim() : "missing / not on PATH"),
  );
  ready &&= available;
}
console.log(
  "Also required: MSVC C++ build tools, Windows SDK and WebView2. This command installs nothing.",
);
console.log(
  "Configuration checks are not a compiled native application or platform acceptance test.",
);
if (!ready) process.exitCode = 1;
