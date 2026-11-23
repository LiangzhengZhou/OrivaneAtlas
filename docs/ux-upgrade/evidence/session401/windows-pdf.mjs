import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

// Use the dedicated unsigned binary and a fresh WebView2 user data directory.
const [out, executable] = process.argv.slice(2);
if (!out || !executable)
  throw Error("Supply a new output directory for the synthetic fixture");
const root = resolve(out);
const exe = resolve(executable);
await mkdir(root);
const probe = createServer();
await new Promise((ok) => probe.listen(0, "127.0.0.1", ok));
const port = probe.address().port;
await new Promise((ok) => probe.close(ok));
const child = spawn(exe, [], {
  cwd: root,
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: resolve(root, "profile"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --disable-background-networking --disable-component-update`,
  },
});
let browser;
try {
  let endpoint;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null)
      throw Error("Isolated fixture exited: " + child.exitCode);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(900),
      });
      if (response.ok) {
        endpoint = await response.json();
        break;
      }
    } catch {
      /* WebView2 starts its debugging endpoint asynchronously. */
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  if (!endpoint) throw Error("WebView2 did not start");
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await page.waitForURL(/tauri\.localhost|tauri:\/\//, { timeout: 25000 });
  await page.evaluate(() => {
    location.hash = "files";
  });
  const { largeSurveyPdf } = await import(
    "../../../../tests/e2e/large-pdf-fixture.ts"
  );
  const bytes = largeSurveyPdf();
  const file = resolve(root, "Native survey.pdf");
  await writeFile(file, bytes, { flag: "wx" });
  await page
    .locator(".files-resource-browser input[type=file]")
    .setInputFiles(file);
  const open = page.getByRole("button", {
    name: /^(View original PDF pages|查看 PDF 原始页面)$/,
  });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Native survey.pdf" });
  const color = () =>
    dialog
      .locator("canvas:visible")
      .evaluate((el) =>
        Array.from(el.getContext("2d").getImageData(12, 12, 1, 1).data),
      );
  await expect.poll(color).toEqual([255, 0, 0, 255]);
  await dialog.getByRole("button", { name: /^(Next page|下一页)$/ }).click();
  await expect.poll(color).toEqual([0, 0, 255, 255]);
  await page.screenshot({ path: resolve(root, "native-large-page.png") });
  await dialog.getByRole("button", { name: /^(Close|关闭)$/ }).click();
  await expect(open).toBeFocused();
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify(
      {
        engine: endpoint.Browser,
        bytes: bytes.length,
        pageOne: [255, 0, 0, 255],
        pageTwo: [0, 0, 255, 255],
        focusReturned: true,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
