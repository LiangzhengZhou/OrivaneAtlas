import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

// Use the unsigned, isolated UX 400 binary built with windows-fixture.json.
const [out] = process.argv.slice(2);
if (!out)
  throw Error("Supply a new output directory for the synthetic fixture");
const root = resolve(out);
const exe = resolve(".artifacts/ux400/native-target/release/arclattice.exe");
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
    location.hash = "calendar";
  });
  const views = page.getByRole("group", {
    name: /^(Calendar views|日历视图)$/,
  });
  await views.getByRole("button", { name: /^(Week|周)$/ }).click();
  const date = page.getByLabel(/^(Choose date|选择日期)$/);
  await date.fill("2028-02-29");
  await expect(page.locator(".calendar-period-list button")).toHaveCount(7);
  await views.getByRole("button", { name: /^(Day|日)$/ }).click();
  await page.getByRole("button", { name: /^(Next period|下一时段)$/ }).click();
  await expect(date).toHaveValue("2028-03-01");
  await page
    .getByRole("button", { name: /^(Previous period|上一时段)$/ })
    .click();
  await views.getByRole("button", { name: /^(Agenda|议程)$/ }).click();
  await expect(date).toHaveValue("2028-02-29");
  await expect(page.locator(".calendar-period-list [role=status]")).toHaveText(
    /No entries this month|本月没有日程/,
  );
  await page.screenshot({ path: resolve(root, "agenda.png") });
  await views.getByRole("button", { name: /^(Month|月)$/ }).click();
  await expect(
    page.locator('.calendar-day[aria-pressed="true"]'),
  ).toHaveAttribute("aria-label", "2028-02-29");
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (viewport.overflow > 0) throw Error("Horizontal overflow");
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify(
      {
        engine: endpoint.Browser,
        viewport,
        selected: "2028-02-29",
        steps: [
          "week seven days",
          "day crosses into March",
          "agenda empty month",
          "month restores leap day",
        ],
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
