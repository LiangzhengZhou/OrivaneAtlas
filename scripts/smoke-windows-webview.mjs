import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

if (process.platform !== "win32" || !process.argv[2] || !process.argv[3])
  throw Error(
    "Usage on Windows: node scripts/smoke-windows-webview.mjs <new-output-directory> <isolated-fixture.exe>",
  );
const root = resolve(process.argv[2]);
const exe = resolve(process.argv[3]);
const product = execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-Item -LiteralPath $env:ATLAS_WEBVIEW_FIXTURE_EXE).VersionInfo.ProductName",
  ],
  {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ATLAS_WEBVIEW_FIXTURE_EXE: exe },
  },
).trim();
if (product !== "Atlas UX fixture")
  throw Error("Build the isolated Atlas UX fixture before running this test");
await mkdir(root);
const portProbe = createServer();
await new Promise((ok) => portProbe.listen(0, "127.0.0.1", ok));
const port = portProbe.address().port;
await new Promise((ok) => portProbe.close(ok));
const child = spawn(exe, [], {
  cwd: root,
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: resolve(root, "profile"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=" +
      port +
      " --remote-debugging-address=127.0.0.1 --disable-background-networking --disable-component-update",
  },
});
let browser;
try {
  let ep;
  for (let n = 0; n < 120; n++) {
    if (child.exitCode !== null)
      throw Error("Fixture exited " + child.exitCode);
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/json/version", {
        signal: AbortSignal.timeout(900),
      });
      if (res.ok) {
        ep = await res.json();
        break;
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 500));
  }
  if (!ep) throw Error("No WebView2 CDP endpoint");
  browser = await chromium.connectOverCDP(ep.webSocketDebuggerUrl);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent("page"));
  await page.waitForURL(/tauri\.localhost|tauri:\/\//, { timeout: 25_000 });
  const originalURL = page.url();
  await page.evaluate(() => {
    location.hash = "files";
  });
  const files = page.locator(".files-resource-browser");
  await files.waitFor({ timeout: 25_000 });
  await files.locator("input[type=file]").setInputFiles([
    {
      name: "Windows sample.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("WebView2 local fixture"),
    },
    {
      name: "Measurements.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("station,height\nA,23"),
    },
  ]);
  const row = files.getByRole("button", { name: /Measurements\.csv ·/ });
  await row.waitFor();
  await row.focus();
  await row.press("Space");
  await files.locator(".files-detail-panel").waitFor();
  await page.screenshot({ path: resolve(root, "windows-files.png") });
  await page.keyboard.press("Escape");
  await row.focus();
  await row.press("Enter");
  await page.locator(".file-table-scroll table").waitFor({ timeout: 20_000 });
  if (!(await page.getByRole("cell", { name: "23", exact: true }).count()))
    throw Error("table cell missing");
  await page.screenshot({ path: resolve(root, "windows-table.png") });
  await page.evaluate(() => {
    location.hash = "files";
  });
  await files
    .locator("input[type=file]")
    .setInputFiles({
      name: "Windows mark.png",
      mimeType: "image/png",
      buffer: await readFile(resolve("apps/web/public/favicon.png")),
    });
  await page.getByRole("button", { name: /^(View image|查看图片)$/ }).click();
  const image = page.getByRole("dialog", { name: "Windows mark.png" });
  await image.getByRole("img", { name: "Windows mark.png" }).waitFor();
  await image.getByRole("button", { name: /^(Zoom in|放大)$/ }).click();
  await page.screenshot({ path: resolve(root, "windows-image.png") });
  await image.getByRole("button", { name: /^(Close|关闭)$/ }).click();
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify(
      {
        originalURL,
        engine: ep.Browser,
        viewport: await page.evaluate(() => [innerWidth, innerHeight]),
        steps: [
          "offline files",
          "two original files",
          "keyboard inspect",
          "keyboard open",
          "CSV preview",
          "private PNG decode and zoom",
        ],
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
