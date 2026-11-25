import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const [output, executable] = process.argv.slice(2);
if (!output || !executable || process.platform !== "win32")
  throw Error(
    "Supply a new output directory and the isolated Windows fixture.",
  );
const root = resolve(output),
  exe = resolve(executable);
const productName = execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-Item -LiteralPath $env:ATLAS_FIXTURE_PATH).VersionInfo.ProductName",
  ],
  {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ATLAS_FIXTURE_PATH: exe },
  },
).trim();
if (productName !== "Atlas UX 410 fixture")
  throw Error("Unexpected fixture product name.");
await mkdir(root);
const probe = createServer();
await new Promise((done, fail) =>
  probe.once("error", fail).listen(0, "127.0.0.1", done),
);
const port = probe.address().port;
await new Promise((done, fail) =>
  probe.close((error) => (error ? fail(error) : done())),
);
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
  const endpoint = "http://127.0.0.1:" + port + "/json/version";
  let version;
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null)
          throw Error("Fixture exited " + child.exitCode);
        try {
          const response = await fetch(endpoint, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) version = await response.json();
        } catch {
          /* WebView2 is still starting. */
        }
        return Boolean(version?.webSocketDebuggerUrl);
      },
      { timeout: 60000 },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  page.setDefaultTimeout(15000);
  await page.waitForURL(/tauri\.localhost|tauri:\/\//);

  await page.evaluate(() => {
    location.hash = "files?library=1";
  });
  const library = page.locator(".files-resource-browser");
  const names = Array.from(
    { length: 12 },
    (_, i) => "Field sample " + (i + 1) + ".txt",
  );
  await library.locator("input[type=file]").setInputFiles(
    names.map((name) => ({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("A synthetic field observation."),
    })),
  );
  await expect(library.locator(".files-resource-row")).toHaveCount(12);
  const action = library.getByRole("button", {
    name: /^(添加到文件夹|Add to folder) · Field sample 1\.txt$/,
  });
  await action.press("Enter");
  const picker = page.getByRole("dialog", {
    name: /^(添加到集合文件夹|Add to collection folder)$/,
  });
  await picker.getByRole("textbox").fill("Field samples");
  await picker
    .getByRole("button", { name: /新建文件夹|Create folder/ })
    .click();
  const target = picker.getByRole("button", {
    name: "Field samples",
    exact: true,
  });
  await expect(target).toBeEnabled();
  await page.screenshot({ path: resolve(root, "windows-folder-picker.png") });
  await target.press("Enter");
  await expect(picker).toBeHidden();
  const folder = library.getByRole("combobox", {
    name: /^(集合文件夹|Collection folder)$/,
  });
  await folder.selectOption({ label: "Field samples" });
  await expect(library.locator(".files-resource-row")).toHaveCount(1);
  await expect(library.locator(".files-resource-row")).toContainText(names[0]);
  await page.reload();
  await folder.selectOption({ label: "Field samples" });
  await expect(library.locator(".files-resource-row")).toHaveCount(1);
  await expect(library.locator(".files-resource-location")).toHaveText(
    "Field samples",
  );
  await page.screenshot({ path: resolve(root, "windows-collection.png") });
  const view = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    origin: location.origin,
  }));
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify(
      {
        browser: version.Browser,
        ...view,
        uploaded: names.length,
        keyboardFiling: true,
        membershipAfterReload: true,
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
