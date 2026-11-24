import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

const [distArg, outArg] = process.argv.slice(2);
if (!distArg || !outArg)
  throw new Error("Usage: node measure.mjs <web-dist> <output-directory>");
const dist = resolve(distArg),
  out = resolve(outArg);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const measurements = [];
try {
  for (const [width, height, theme, forcedColors] of [
    [1440, 900, "light", "none"],
    [900, 800, "light", "none"],
    [390, 844, "light", "none"],
    [360, 800, "dark", "none"],
    [320, 700, "light", "active"],
  ]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height },
      isMobile: width < 600,
      hasTouch: width < 600,
      colorScheme: theme,
      forcedColors,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          url.origin !== "http://127.0.0.1:1420" ||
          url.pathname.startsWith("/api/")
        )
          return route.abort();
        const path = resolve(
          dist,
          "." +
            (url.pathname === "/"
              ? "/index.html"
              : decodeURIComponent(url.pathname)),
        );
        if (!path.startsWith(dist + sep)) return route.abort();
        const types = {
          ".css": "text/css",
          ".html": "text/html",
          ".js": "text/javascript",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".woff2": "font/woff2",
        };
        try {
          await route.fulfill({
            body: await readFile(path),
            contentType: types[extname(path)] || "application/octet-stream",
          });
        } catch {
          await route.fulfill({ status: 404 });
        }
      });
      await page.goto("http://127.0.0.1:1420/#tasks");
      const newTask = page.locator(".page-header .compact-create");
      await expect(newTask).toBeEnabled();
      for (const title of [
        "确认周五的预约时间",
        "整理下次拜访家人时需要带上的资料和物品，再把重要事项写进备忘录",
        "读完借来的书",
      ]) {
        await newTask.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("标题", { exact: true }).fill(title);
        await dialog
          .getByRole("button", { name: "新建任务", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
      }
      await expect(page.locator(".task-card")).toHaveCount(3);
      const now = page.getByRole("tab", { name: "现在", exact: true });
      await page.keyboard.press("Tab");
      await now.focus();
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelector(".content")?.scrollTo(0, 0);
      });
      await page.screenshot({
        path: resolve(out, width + "-" + theme + ".png"),
        animations: "disabled",
      });
      const data = await page.evaluate(() => {
        const first = document
          .querySelector(".task-card")
          .getBoundingClientRect();
        const dock = document.querySelector(".mobile-bottom-navigation");
        const bottom = dock?.getBoundingClientRect().height
          ? dock.getBoundingClientRect().top
          : innerHeight;
        return {
          top: first.top,
          bottom: first.bottom,
          entireRowsVisible: [
            ...document.querySelectorAll(".task-card"),
          ].filter(
            (el) =>
              el.getBoundingClientRect().bottom <= bottom &&
              el.getBoundingClientRect().top >= 0,
          ).length,
          overflow: document.documentElement.scrollWidth > innerWidth,
          theme: document.documentElement.dataset.theme,
        };
      });
      expect(data.overflow).toBe(false);
      measurements.push({ width, height, forcedColors, ...data });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  resolve(out, "layout.json"),
  JSON.stringify({ build: basename(dist), measurements }, null, 2) + "\n",
);
