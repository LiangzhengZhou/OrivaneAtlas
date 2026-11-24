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
if (productName !== "Atlas UX 404 fixture")
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
    location.hash = "notes";
  });
  const strip = page.locator(".document-tabs");
  const saved = page.locator(
    '.document-toolbar:visible [data-locally-saved="true"]',
  );
  const titleInput = page.locator(".document-title:visible");
  for (const title of ["山野一", "山野二", "山野三"]) {
    await page.locator(".page-header .compact-create").click();
    await titleInput.fill(title);
    await titleInput.press("Control+s");
    await expect(saved).toBeVisible();
    if (title !== "山野三") await strip.locator(":scope > button").click();
  }
  const tab = (name) => strip.getByRole("tab", { name, exact: true });
  await tab("山野三").press("Home");
  await expect(tab("山野一")).toBeFocused();
  await tab("山野一").press("ArrowRight");
  await expect(tab("山野二")).toBeFocused();
  await titleInput.focus();
  await titleInput.press("End");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "biji",
    selectionStart: 4,
    selectionEnd: 4,
  });
  await cdp.send("Input.insertText", { text: "笔记" });
  await cdp.detach();
  await expect(titleInput).toHaveValue("山野二笔记");
  await strip
    .getByRole("button", { name: /^(Close|关闭) 山野二笔记$/ })
    .press("Enter");
  await expect(tab("山野三")).toBeFocused();
  await expect(strip.getByRole("tab")).toHaveCount(2);
  const focus = await tab("山野三").evaluate((el) => ({
    visible: el.matches(":focus-visible"),
    shadow: getComputedStyle(el).boxShadow,
    outline: getComputedStyle(el).outlineStyle,
    panelVisible: document
      .getElementById(el.getAttribute("aria-controls"))
      ?.checkVisibility(),
  }));
  expect(focus.visible).toBe(true);
  expect(focus.outline).toBe("solid");
  expect(focus.panelVisible).toBe(true);
  await page.screenshot({ path: resolve(root, "windows-tabs.png") });
  await strip.locator(":scope > button").click();
  await page.reload();
  await page
    .locator(".note-card")
    .filter({ hasText: "山野二笔记" })
    .press("Enter");
  await expect(titleInput).toHaveValue("山野二笔记");
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify(
      {
        engine: version.Browser,
        productName,
        confirmedTitleAfterReload: "山野二笔记",
        focus,
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
