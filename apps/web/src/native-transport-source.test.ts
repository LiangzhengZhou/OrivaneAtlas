import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("native JSON stays text throughout the bridge; only binary replies use Base64", () => {
  const native = readFileSync("src-tauri/src/transport.rs", "utf8");
  const branch = native.slice(
    native.indexOf("let (body, encoding) = if is_json"),
  );
  const json = branch.slice(0, branch.indexOf("} else {"));
  const binary = branch.slice(
    branch.indexOf("} else {"),
    branch.indexOf("Ok(Reply"),
  );
  expect(json).toContain("String::from_utf8");
  expect(json).toContain('"utf8"');
  expect(json).not.toContain("base64");
  expect(binary).toContain("STANDARD.encode(bytes)");
  expect(binary).toContain('"base64"');
  const web = readFileSync("apps/web/src/bootstrap.ts", "utf8");
  expect(web).toMatch(/reply\.encoding === "utf8"\s*\? reply\.body/);
  expect(web).toMatch(/:\s*Uint8Array\.from\(atob\(reply\.body\)/);
});
