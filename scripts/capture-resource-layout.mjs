import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const mode = process.argv[2];
if (
  !["layout", "options"].includes(mode) ||
  !process.argv[3] ||
  !process.argv[4]
)
  throw Error(
    "Usage: node scripts/capture-resource-layout.mjs <layout|options> <built-dist> <new-output-directory>",
  );
const dir = resolve(process.argv[4]);
const dist = resolve(process.argv[3]);
await readFile(resolve(dist, "index.html"));
await mkdir(dir);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost").pathname;
    const file = resolve(dist, "." + (url === "/" ? "/index.html" : url));
    if (!file.startsWith(dist + sep) || url.startsWith("/api/")) throw Error();
    const bytes = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".html": "text/html",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        }[extname(file)] || "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch();
const measurements = [];
try {
  for (const [width, height] of mode === "options"
    ? [[1280, 800]]
    : [
        [1440, 900],
        [768, 1024],
        [360, 800],
      ]) {
    for (const theme of mode === "options"
      ? ["survey", "folio"]
      : ["light", "dark"]) {
      const ctx = await browser.newContext({
        viewport: { width, height },
        locale: width === 360 ? "zh-CN" : "en-US",
        serviceWorkers: "block",
        hasTouch: width === 360,
      });
      const page = await ctx.newPage();
      await page.addInitScript(
        (theme) =>
          localStorage.setItem(
            "orivane-atlas.theme",
            theme === "dark" ? "dark" : "light",
          ),
        theme,
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/#files");
      await page.locator(".files-resource-browser").waitFor();
      if (mode === "options")
        await page.addStyleTag({
          content:
            theme === "folio"
              ? ":root[data-palette]{--canvas:#f7f4f0;--sidebar-surface:#eee7df;--surface:#fffaf6;--accent:#7b4458;--text-muted:#625b60} .page-header h1{font-family:Georgia,serif}"
              : ":root[data-palette]{--canvas:#f5f4ec;--sidebar-surface:#eaece3;--surface:#fefdf8;--accent:#165d57;--text-muted:#54645e}.page-header h1{font-family:Georgia,serif}",
        });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: dir + "/" + width + "-" + theme + "-files.png",
        animations: "disabled",
      });
      measurements.push(
        await page.evaluate(
          ({ width, height, theme }) => ({
            width,
            height,
            theme,
            overflow: document.documentElement.scrollWidth - innerWidth,
            heading: document.querySelector("h1")?.innerText,
            canvas: getComputedStyle(document.documentElement).getPropertyValue(
              "--canvas",
            ),
          }),
          { width, height, theme },
        ),
      );
      await ctx.close();
    }
  }
  await writeFile(
    dir + "/layout.json",
    JSON.stringify(measurements, null, 2) + "\n",
  );
} finally {
  await browser.close();
  server.close();
}
