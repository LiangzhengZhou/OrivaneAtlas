import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const [output, executable, phase, scale] = process.argv.slice(2);
if (
  !["before", "after"].includes(phase) ||
  (scale !== undefined && !["1.25", "1.5", "2"].includes(scale)) ||
  !output ||
  !executable ||
  process.platform !== "win32"
)
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
if (productName !== "Atlas UX 407 fixture")
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
      " --remote-debugging-address=127.0.0.1 --disable-background-networking --disable-component-update" +
      (scale ? " --force-device-scale-factor=" + scale : ""),
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

  const resize = (width) =>
    JSON.parse(
      execFileSync(
        "pwsh",
        [
          "-NoProfile",
          "-File",
          resolve("docs/ux-upgrade/evidence/session407/window-size.ps1"),
          "-FixtureProcess",
          String(child.pid),
          "-LogicalWidth",
          String(width),
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
  const wide = resize(0);
  await page.evaluate(() => {
    location.hash = "tasks";
  });
  const tasks = page.locator(".personal-tasks");
  await expect(tasks).toBeVisible();
  const list = tasks.locator(".task-card");
  await expect(list).toHaveCount(0);
  const names = [
    "读完借来的书",
    "整理周五评审的资料并确认截止日期",
    "确认下次预约时间",
  ];
  for (const text of names) {
    await page.locator(".page-header .compact-create").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /^(Title|标题)$/ }).fill(text);
    await dialog
      .getByRole("button", { name: /^(新建任务|Create task)$/, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  }
  const row = list.filter({ hasText: names[1] });
  const title = row.locator(".task-title");
  const timer = row.locator(".task-timer");
  const button = timer.getByRole("button");
  const geometry = () =>
    page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      ratio: devicePixelRatio,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
  const wideView = await geometry();
  if (scale) expect(wideView.ratio).toBeCloseTo(Number(scale), 2);
  await button.focus();
  await page.screenshot({ path: resolve(root, "windows-list.png") });
  await button.click();
  await expect(timer).toHaveAttribute("data-running", "true");
  await expect(timer.locator(".task-timer-elapsed")).not.toHaveText("00:00:00");
  await button.press("Space");
  await expect(timer).toHaveAttribute("data-running", "false");
  await expect(button).toHaveAccessibleName(/^(继续计时|Continue timer)$/);
  await title.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const topOf = (locator) =>
    locator.evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const titleY = await topOf(
    dialog.getByRole("textbox", { name: /^(标题|Title)$/ }),
  );
  const statusY = await topOf(
    dialog.getByRole("combobox", { name: /^(状态|Status)$/ }),
  );
  await page.screenshot({ path: resolve(root, "windows-details.png") });
  if (phase === "after") {
    expect(Math.abs(titleY - statusY)).toBeLessThan(3);
    await expect(
      dialog.getByRole("textbox", { name: /^(标题|Title)$/ }),
    ).toBeFocused();
    await expect(dialog.locator(".task-relationships")).not.toHaveAttribute(
      "open",
      "",
    );
  }
  await dialog.getByRole("button", { name: /^(截止日期|Due date)$/ }).click();
  const day = page.getByRole("button", { name: /^\d{4}-\d{2}-15$/ }).first();
  const deadline = await day.getAttribute("aria-label");
  await day.click();
  await dialog
    .getByRole("button", { name: /^(保存修改|Save changes)$/ })
    .click();
  await expect(row.locator("time")).toHaveText(deadline);
  if (phase === "after") await expect(title).toBeFocused();
  const narrow = resize(690);
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(750);
  const narrowView = await geometry();
  expect(narrowView.overflow).toBe(false);
  const mainTop = await topOf(page.locator("main.workspace-main"));
  if (phase === "after") {
    expect(mainTop).toBeLessThan(100);
    const nav = page.locator(".sidebar .mobile-navigation-toggle");
    await nav.press("Enter");
    await expect(page.locator("#mobile-more-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-more-sheet")).toBeHidden();
    await expect(
      page.locator(".sidebar .mobile-navigation-toggle"),
    ).toBeVisible();
  }
  if (phase === "after") {
    await tasks.getByRole("button", { name: /^(选择|Select)$/ }).click();
    await title.press("Enter");
    await expect(title).toHaveAttribute("aria-pressed", "true");
    await expect(dialog).toHaveCount(0);
    await title.press("Space");
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    await tasks
      .getByRole("button", { name: /^(结束选择|Done selecting)$/i })
      .click();
  }
  await button.press("Tab");
  await page.screenshot({ path: resolve(root, "windows-narrow.png") });
  if (phase === "after") {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.screenshot({ path: resolve(root, "windows-narrow-dark.png") });
    await page.emulateMedia({ forcedColors: "active" });
    await button.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    await page.screenshot({ path: resolve(root, "windows-forced-colors.png") });
    await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
  }
  const complete = row.getByRole("button", { name: /^(完成：|Complete: )/ });
  await complete.press("Enter");
  await row
    .getByRole("button", { name: /^(确认完成|Confirm complete)$/ })
    .press("Enter");
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /^(撤销|Undo)$/ }).press("Enter");
  await expect(row).toHaveCount(1);
  await page.reload();
  await expect(row.locator("time")).toHaveText(deadline);
  await expect(row.locator(".task-timer button")).toHaveAccessibleName(
    /^(继续计时|Continue timer)$/,
  );
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify(
      {
        phase,
        engine: version.Browser,
        wide,
        wideView,
        narrow,
        narrowView,
        mainTop,
        titleY,
        statusY,
        deadline,
        completedAndUndone: true,
        pausedAfterReload: true,
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
