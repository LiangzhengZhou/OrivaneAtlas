import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("every registered native command has an explicit main-window local-only capability", () => {
  const read = (path: string) => readFileSync(resolve(path), "utf8");
  const handlers = read("src-tauri/src/lib.rs").match(
    /generate_handler!\[([\s\S]*?)\]/,
  )?.[1];
  if (!handlers) throw new Error("Missing native handler registry");
  const commands = [...handlers.matchAll(/\w+::(\w+)/g)]
    .map((match) => match[1]!)
    .sort();
  expect(commands).toEqual(
    expect.arrayContaining([
      "server_upload_chunk",
      "server_download_file",
      "notification_permission",
      "notification_request_permission",
      "notification_reconcile",
      "notification_cancel",
    ]),
  );
  const manifest = read("src-tauri/build.rs").match(
    /\.commands\(&\[([\s\S]*?)\]/,
  )?.[1];
  if (!manifest) throw new Error("Missing native app ACL manifest");
  expect(
    [...manifest.matchAll(/"(\w+)"/g)].map((match) => match[1]!).sort(),
  ).toEqual(commands);
  const capability: {
    local: boolean;
    remote?: unknown;
    windows: string[];
    permissions: string[];
  } = JSON.parse(read("src-tauri/capabilities/default.json"));
  expect(capability.local).toBe(true);
  expect(capability.remote).toBeUndefined();
  expect(capability.windows).toEqual(["main"]);
  expect([...capability.permissions].sort()).toEqual(
    commands.map((command) => `allow-${command.replaceAll("_", "-")}`).sort(),
  );
});
