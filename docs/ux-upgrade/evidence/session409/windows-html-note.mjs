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
if (productName !== "Atlas UX 409 fixture")
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
  const source =
    "<!doctype html><html><head><title>Windows field book</title><style>h2{color:rgb(12,72,96)}</style></head><body><h2>Garden</h2><table><tr><td>Lavender</td></tr></table></body></html>";
  await page.locator('.page-header input[accept=".html,.htm"]').setInputFiles({
    name: "field-book.html",
    mimeType: "text/html",
    buffer: Buffer.from(source),
  });
  const panel = page
    .getByRole("tabpanel")
    .filter({ has: page.locator(".document-title") });
  const preview = panel.frameLocator(".html-note-preview");
  await expect(preview.getByRole("heading", { name: "Garden" })).toHaveCSS(
    "color",
    "rgb(12, 72, 96)",
  );
  await expect(preview.getByRole("cell")).toHaveText("Lavender");
  await expect(panel.locator(".html-note-preview")).toHaveAttribute(
    "sandbox",
    "",
  );
  await page.screenshot({ path: resolve(root, "windows-html-note.png") });
  const edit = panel
    .getByRole("group", { name: /^(文档视图|Document view)$/ })
    .getByRole("button", { name: /^(编辑|Edit)$/ });
  if (await edit.count()) await edit.click();
  else {
    await panel.locator(".document-mode-menu > button").click();
    await panel
      .locator(".document-mode-menu")
      .getByRole("button", { name: /^(编辑|Edit)$/ })
      .click();
  }
  const input = panel.getByRole("textbox", {
    name: /^(HTML 源码|HTML source)$/,
  });
  await expect(input).toHaveValue(source);
  await input.fill(source.replace("Lavender", "Rosemary"));
  await input.press("Control+s");
  await expect(
    panel.locator(".document-toolbar [role=status]"),
  ).toHaveAttribute("data-locally-saved", "true");
  await page.reload();
  await page
    .locator(".note-card, .library-document-row")
    .filter({ hasText: "Windows field book" })
    .first()
    .press("Enter");
  await expect(preview.getByRole("cell")).toHaveText("Rosemary");
  const metadata = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    origin: location.origin,
    userAgent: navigator.userAgent,
  }));
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify(
      { browser: version.Browser, ...metadata, importReadEditSaveReload: true },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
